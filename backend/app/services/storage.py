"""Where uploaded files live.

Uploads used to be written straight to a relative "uploads" directory, which
on a free-tier host is the container's own disk — wiped on every redeploy.
That silently broke three features at once: document download, the document
editor (which re-reads the original file), and image questions (which read the
image off disk to send to the vision model).

Two implementations behind one interface:

  LocalDiskStorage    development, and any deployment with a real volume
  SupabaseStorage     production, using the same free project as the database

Keys are derived, never stored: `{document_id}_{filename}` matches the naming
the local directory already used, so existing files keep working and no schema
migration is needed. Ownership is checked against the database before any call
here — this layer is deliberately not an authorisation boundary, it just moves
bytes.
"""
from __future__ import annotations

import logging
import os
import tempfile
from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Raised when the backing store fails in a way the caller must handle."""


def build_key(document_id: str, filename: str) -> str:
    """The storage key for a document's original file.

    Derived rather than persisted so that adding this abstraction needed no
    migration: `filename` is already on DocumentRecord, and this reproduces the
    exact `{id}_{name}` convention the uploads directory used.
    """
    return f"{document_id}_{filename}"


class Storage(ABC):
    """Minimal contract — everything the app actually does with a file."""

    @abstractmethod
    async def save(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    async def read(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    @abstractmethod
    async def exists(self, key: str) -> bool: ...

    @abstractmethod
    async def local_path(self, key: str) -> Optional[str]:
        """A real filesystem path, if this backend has one.

        Exists because the ingestion pipeline and the vision model both take a
        path, not bytes. Remote backends return None and callers stage a temp
        file instead — see `materialize`.
        """


class LocalDiskStorage(Storage):
    def __init__(self, root: str):
        # Resolved to an absolute path at construction: the previous relative
        # "uploads" was interpreted against the process working directory, so
        # the same code read different directories depending on how it was
        # started (uvicorn from backend/ vs docker WORKDIR /app).
        self.root = os.path.abspath(root)
        os.makedirs(self.root, exist_ok=True)

    def _path(self, key: str) -> str:
        # Keys are built from sanitised filenames, but this layer must not
        # assume its caller got that right — a key containing ".." would
        # otherwise write anywhere on disk.
        full = os.path.abspath(os.path.join(self.root, key))
        if os.path.commonpath([full, self.root]) != self.root:
            raise StorageError("Refusing to access a path outside the store")
        return full

    async def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(data)

    async def read(self, key: str) -> bytes:
        try:
            with open(self._path(key), "rb") as handle:
                return handle.read()
        except FileNotFoundError as exc:
            raise StorageError(f"Not found: {key}") from exc

    async def delete(self, key: str) -> None:
        try:
            os.remove(self._path(key))
        except OSError:
            pass  # Already gone is the desired end state.

    async def exists(self, key: str) -> bool:
        return os.path.isfile(self._path(key))

    async def local_path(self, key: str) -> Optional[str]:
        path = self._path(key)
        return path if os.path.isfile(path) else None


class SupabaseStorage(Storage):
    """Supabase Storage over its REST API.

    The bucket must be **private**. A public bucket would make every uploaded
    document readable by URL to anyone, which is precisely the exposure the
    session gate was added to close.
    """

    def __init__(self, url: str, service_key: str, bucket: str):
        self.base = f"{url.rstrip('/')}/storage/v1/object"
        self.bucket = bucket
        # The service-role key bypasses row-level security, so it must stay
        # server-side. It is never sent to the browser.
        self.headers = {"Authorization": f"Bearer {service_key}"}

    async def save(self, key: str, data: bytes) -> None:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base}/{self.bucket}/{key}",
                headers={
                    **self.headers,
                    "Content-Type": "application/octet-stream",
                    # Re-indexing an edited document rewrites the same key.
                    "x-upsert": "true",
                },
                content=data,
            )
        if response.status_code >= 400:
            logger.error("Supabase upload failed (%s)", response.status_code)
            raise StorageError("Could not store the uploaded file")

    async def read(self, key: str) -> bytes:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                f"{self.base}/{self.bucket}/{key}", headers=self.headers
            )
        if response.status_code == 404:
            raise StorageError(f"Not found: {key}")
        if response.status_code >= 400:
            raise StorageError("Could not read the stored file")
        return response.content

    async def delete(self, key: str) -> None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.delete(
                f"{self.base}/{self.bucket}/{key}", headers=self.headers
            )

    async def exists(self, key: str) -> bool:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # HEAD on the object avoids pulling the whole body just to check.
            response = await client.head(
                f"{self.base}/{self.bucket}/{key}", headers=self.headers
            )
        return response.status_code < 400

    async def local_path(self, key: str) -> Optional[str]:
        return None


def build_storage() -> Storage:
    """Pick a backend from configuration.

    Supabase is used when it is fully configured; otherwise local disk, so a
    developer with no Supabase project still gets a working app.
    """
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY:
        logger.info("File storage: Supabase bucket '%s'", settings.SUPABASE_BUCKET)
        return SupabaseStorage(
            settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY, settings.SUPABASE_BUCKET
        )
    logger.warning(
        "File storage: local disk at '%s'. On a host with an ephemeral "
        "filesystem, uploaded files are lost on every redeploy — set "
        "SUPABASE_URL and SUPABASE_SERVICE_KEY to persist them.",
        settings.UPLOAD_DIR,
    )
    return LocalDiskStorage(settings.UPLOAD_DIR)


storage: Storage = build_storage()


_IMAGE_CACHE_DIR = os.path.join(tempfile.gettempdir(), "scribe-image-cache")


async def cached_path(key: str, suffix: str = "") -> Optional[str]:
    """A stable local path for an object, cached across requests.

    `materialize` deletes its temp file when the block exits, which is wrong
    for images used during answer generation: the streaming response reads them
    after the request handler has returned. These are cached by key instead and
    reused — the underlying object is immutable for a given key, so a cache hit
    is always correct, and the OS reclaims the temp directory.

    Returns None if the object is missing, so a deleted image degrades the
    answer rather than failing the whole query.
    """
    direct = await storage.local_path(key)
    if direct is not None:
        return direct

    os.makedirs(_IMAGE_CACHE_DIR, exist_ok=True)
    # Keys contain a UUID, so a flat filename is already collision-free; the
    # separator is replaced only because it is not path-safe.
    cached = os.path.join(_IMAGE_CACHE_DIR, key.replace("/", "_") + suffix)
    if os.path.isfile(cached):
        return cached

    try:
        data = await storage.read(key)
    except StorageError:
        logger.warning("Image object missing from storage: %s", key)
        return None

    with open(cached, "wb") as handle:
        handle.write(data)
    return cached


@asynccontextmanager
async def materialize(key: str, suffix: str = "") -> AsyncIterator[str]:
    """Yield a real filesystem path for `key`, whatever the backend.

    The document processor and the vision model both take a path — they read
    files with PyPDF2, python-docx, Pillow and friends, none of which accept
    bytes uniformly. Rather than rewrite all of that, remote objects are staged
    to a temp file for the duration of the operation and removed afterwards.
    Local storage yields its real path and copies nothing.
    """
    existing = await storage.local_path(key)
    if existing is not None:
        yield existing
        return

    data = await storage.read(key)
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        handle.write(data)
        handle.close()
        yield handle.name
    finally:
        try:
            os.remove(handle.name)
        except OSError:
            pass
