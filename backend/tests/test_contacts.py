"""Invite-link security rules.

A link is a bearer credential, so these tests are mostly about what happens
when one escapes: a forwarded link must not work on a second device, a revoked
one must stop immediately, and a contact cookie must never be mistaken for the
owner's.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import contacts
from app.identity import resolve_identity
from app.session import OWNER_TENANT_ID, issue


class TestTokens:
    def test_tokens_are_unguessable_and_unique(self):
        issued = {contacts.generate_token() for _ in range(200)}
        assert len(issued) == 200
        assert all(len(t) >= 40 for t in issued)

    def test_only_the_hash_is_storable(self):
        """A database leak must not hand over working links."""
        token = contacts.generate_token()
        stored = contacts.hash_token(token)
        assert token not in stored
        assert len(stored) == 64

    def test_matching_is_by_hash(self):
        token = contacts.generate_token()
        stored = contacts.hash_token(token)
        assert contacts.tokens_match(token, stored)
        assert not contacts.tokens_match(contacts.generate_token(), stored)


class TestDeviceBinding:
    """The measure that makes a forwarded WhatsApp link useless."""

    def test_first_device_is_admitted(self):
        assert contacts.check_device(bound_device=None, presented_device="abc")

    def test_bound_device_is_admitted_again(self):
        assert contacts.check_device(bound_device="abc", presented_device="abc")

    def test_a_second_device_is_refused(self):
        assert not contacts.check_device(bound_device="abc", presented_device="xyz")

    def test_device_id_is_scoped_to_the_contact(self):
        """Salting with the contact's own token hash means the same phone
        yields different ids per contact, so values cannot be correlated
        between them."""
        a = contacts.derive_device_id("Mozilla/5.0", "1.2.3.4", salt="contact-a")
        b = contacts.derive_device_id("Mozilla/5.0", "1.2.3.4", salt="contact-b")
        assert a != b

    def test_device_id_is_stable_for_the_same_inputs(self):
        first = contacts.derive_device_id("Mozilla/5.0", "1.2.3.4", salt="s")
        second = contacts.derive_device_id("Mozilla/5.0", "1.2.3.4", salt="s")
        assert first == second


class TestRevocationAndExpiry:
    def test_a_live_link_passes(self):
        contacts.check_usable(revoked_at=None, expires_at=None)

    def test_a_revoked_link_is_refused(self):
        with pytest.raises(contacts.ContactError, match="revoked"):
            contacts.check_usable(
                revoked_at=datetime.now(timezone.utc), expires_at=None
            )

    def test_an_expired_link_is_refused(self):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        with pytest.raises(contacts.ContactError, match="expired"):
            contacts.check_usable(revoked_at=None, expires_at=past)

    def test_a_future_expiry_still_works(self):
        future = datetime.now(timezone.utc) + timedelta(days=1)
        contacts.check_usable(revoked_at=None, expires_at=future)

    def test_naive_timestamps_do_not_crash(self):
        """Rows written before timezone handling was consistent come back
        naive; comparing them must not raise."""
        naive_past = datetime.now() - timedelta(days=1)
        with pytest.raises(contacts.ContactError):
            contacts.check_usable(revoked_at=None, expires_at=naive_past)


class TestIdentity:
    """The cookie is signed with the same key for everyone, so privilege has
    to come from the payload's kind — not from the signature being valid."""

    @pytest.fixture(autouse=True)
    def gate_enabled(self, monkeypatch):
        """With no passcode configured the app runs in local-development mode
        where every caller is the owner, which would mask exactly the
        distinctions these tests exist to check."""
        from app.config import settings

        monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "test-passcode")

    def test_a_contact_cookie_is_not_the_owner(self):
        identity = resolve_identity(session_cookie=issue(kind="contact:abc-123"))
        assert identity.is_owner is False
        assert identity.contact_id == "abc-123"

    def test_a_contact_reads_the_owners_library(self):
        identity = resolve_identity(session_cookie=issue(kind="contact:abc-123"))
        assert identity.tenant_id == OWNER_TENANT_ID

    def test_a_contact_cannot_manage_documents(self):
        """Otherwise an invite link would carry the right to delete every
        document it can read."""
        identity = resolve_identity(session_cookie=issue(kind="contact:abc-123"))
        assert identity.can_manage_documents is False

    def test_the_owner_can_manage_documents(self):
        identity = resolve_identity(session_cookie=issue(kind="owner"))
        assert identity.is_owner is True
        assert identity.can_manage_documents is True

    def test_a_contact_is_not_a_demo_visitor(self):
        """Demo caps are keyed off is_demo; a contact must not be swept into
        that bucket or the owner's own library would look capped to them."""
        identity = resolve_identity(session_cookie=issue(kind="contact:abc-123"))
        assert identity.is_demo is False

    def test_an_empty_contact_id_is_rejected(self):
        """A malformed 'contact:' payload must not fall through to owner. It
        lands on the same 401 as any unauthenticated caller."""
        with pytest.raises(HTTPException) as exc:
            resolve_identity(session_cookie=issue(kind="contact:"))
        assert exc.value.status_code == 401

    def test_a_forged_cookie_is_not_trusted(self):
        with pytest.raises(HTTPException) as exc:
            resolve_identity(session_cookie="not.a.real.token")
        assert exc.value.status_code == 401


def test_expiry_helper_handles_no_expiry():
    assert contacts.default_expiry(None) is None
    assert contacts.default_expiry(0) is None
    assert contacts.default_expiry(7) is not None


class TestMultiOwner:
    """Each owner has their own contacts. A mistake here means one business
    reads another's conversations, so isolation is asserted directly rather
    than assumed from the query code."""

    @pytest.fixture(autouse=True)
    def gate_enabled(self, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "test-passcode")

    def test_a_contact_resolves_to_their_own_owner(self):
        """The tenant travels inside the signed payload, so a contact of owner
        B must never resolve to owner A's workspace."""
        identity = resolve_identity(
            session_cookie=issue(kind="contact:c-1:owner-b")
        )
        assert identity.contact_id == "c-1"
        assert identity.tenant_id == "owner-b"

    def test_two_contacts_of_different_owners_stay_separate(self):
        a = resolve_identity(session_cookie=issue(kind="contact:c-1:owner-a"))
        b = resolve_identity(session_cookie=issue(kind="contact:c-2:owner-b"))
        assert a.tenant_id != b.tenant_id

    def test_a_legacy_cookie_without_a_tenant_still_works(self):
        """Cookies issued before the owner tenant was carried fall back to the
        original single-owner tenant rather than failing the session."""
        identity = resolve_identity(session_cookie=issue(kind="contact:c-1"))
        assert identity.contact_id == "c-1"
        assert identity.tenant_id == OWNER_TENANT_ID

    def test_a_contact_still_cannot_manage_documents(self):
        identity = resolve_identity(session_cookie=issue(kind="contact:c-1:owner-b"))
        assert identity.can_manage_documents is False
        assert identity.is_contact is True

    def test_tampering_with_the_tenant_invalidates_the_cookie(self):
        """The tenant is inside the signature, so editing it breaks it."""
        cookie = issue(kind="contact:c-1:owner-a")
        payload, signature = cookie.split(".", 1)
        tampered = f"{payload}x.{signature}"
        with pytest.raises(HTTPException):
            resolve_identity(session_cookie=tampered)


class TestBlocking:
    """Block and revoke reach the same refusal but mean different things to the
    owner: revoke kills the link, block refuses the person while keeping their
    link and history."""

    def test_a_blocked_contact_is_refused(self):
        with pytest.raises(contacts.ContactError):
            contacts.check_usable(
                revoked_at=None, expires_at=None,
                blocked_at=datetime.now(timezone.utc),
            )

    def test_blocking_is_checked_before_revocation(self):
        """Both set is possible; the message must be deterministic rather than
        depending on evaluation order."""
        with pytest.raises(contacts.ContactError, match="turned off"):
            contacts.check_usable(
                revoked_at=datetime.now(timezone.utc),
                expires_at=None,
                blocked_at=datetime.now(timezone.utc),
            )

    def test_an_unblocked_contact_still_passes(self):
        contacts.check_usable(revoked_at=None, expires_at=None, blocked_at=None)

    def test_the_refusal_does_not_reveal_which_lever_was_pulled(self):
        """The person on the other end does not need to know whether they were
        blocked or the link was retired."""
        with pytest.raises(contacts.ContactError) as exc:
            contacts.check_usable(
                revoked_at=None, expires_at=None,
                blocked_at=datetime.now(timezone.utc),
            )
        assert "blocked" not in str(exc.value).lower()
