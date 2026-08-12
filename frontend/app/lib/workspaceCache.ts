"use client";

// Shared Workspace & Console Client Cache:
// Eliminates screen-switching loading flickers across the whole app by providing
// instant in-memory and localStorage caching with silent background revalidation (SWR pattern).

import { useEffect, useSyncExternalStore } from "react";
import { ownerFetch } from "./ownerFetch";

export interface WorkspaceCacheData {
  businessName: string | null;
  businessCategory: string | null;
  email: string | null;
  status: "deployed" | "draft" | string | null;
  isBusiness: boolean;
  /** False until the first successful load (from localStorage or the network).
   *  Consumers render a skeleton rather than placeholder values while false. */
  loaded: boolean;
  agentConfig?: any;
  voices?: any;
  languages?: any;
  overviewData?: any;
  contactsData?: any;
  providersData?: any;
  categoriesData?: any;
  lastUpdated: number;
}

const STORAGE_KEY = "scribe_workspace_cache_v2";
const CACHE_TTL_MS = 60_000; // 1 minute background freshness window

const EMPTY_CACHE: WorkspaceCacheData = {
  businessName: null,
  businessCategory: null,
  email: null,
  status: null,
  isBusiness: false,
  loaded: false,
  lastUpdated: 0,
};

let memoryCache: WorkspaceCacheData = { ...EMPTY_CACHE };

// Initialize memory cache from localStorage on browser boot
if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      memoryCache = { ...memoryCache, ...parsed, loaded: true };
    }
  } catch {
    /* ignore */
  }
}

/** Drop everything cached for the previous account. Must be called on sign-out
 *  and sign-in — otherwise the next user briefly sees the last one's business. */
export function clearWorkspaceCache() {
  memoryCache = { ...EMPTY_CACHE };
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  notifyListeners();
}

type CacheListener = () => void;
const listeners = new Set<CacheListener>();

function subscribe(listener: CacheListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

/** Get current cached workspace data synchronously (0ms latency). */
export function getWorkspaceCache(): WorkspaceCacheData {
  return memoryCache;
}

function getServerSnapshot(): WorkspaceCacheData {
  return EMPTY_CACHE;
}

/** Update the workspace cache in memory and localStorage, and notify all subscribers. */
export function setWorkspaceCache(patch: Partial<WorkspaceCacheData>) {
  memoryCache = {
    ...memoryCache,
    ...patch,
    lastUpdated: Date.now(),
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache));
    } catch {
      /* ignore */
    }
  }

  notifyListeners();
}

/** Revalidate core workspace identity and status in background. */
export async function revalidateWorkspace(force = false): Promise<WorkspaceCacheData> {
  const isStale = Date.now() - memoryCache.lastUpdated > CACHE_TTL_MS;
  if (!force && !isStale && memoryCache.loaded) {
    return memoryCache;
  }

  try {
    const [wsRes, agRes] = await Promise.all([
      ownerFetch("/api/v1/workspace"),
      ownerFetch("/api/v1/workspace/agent"),
    ]);

    const patch: Partial<WorkspaceCacheData> = {};

    if (wsRes.ok) {
      const ws = await wsRes.json();
      // Assigned unconditionally, not behind `if (value)`. Guarding on
      // truthiness meant a workspace that had *cleared* its business name kept
      // showing the old one forever, because the cache was only ever added to.
      patch.businessName = ws.business_name ?? null;
      patch.businessCategory = ws.business_category ?? null;
      patch.email = ws.email ?? null;
      patch.isBusiness = ws.is_business ?? false;
      patch.loaded = true;
    }

    if (agRes.ok) {
      const ag = await agRes.json();
      patch.status = ag.status ?? null;
      patch.agentConfig = ag;
    }

    if (Object.keys(patch).length > 0) {
      setWorkspaceCache(patch);
    }
  } catch {
    /* keep cached data on error */
  }

  return memoryCache;
}

/** React hook to access workspace identity and status with 0ms first-render guarantee and SSR hydration safety. */
export function useWorkspace() {
  const data = useSyncExternalStore(
    subscribe,
    getWorkspaceCache,
    getServerSnapshot
  );

  useEffect(() => {
    void revalidateWorkspace();
  }, []);

  return {
    businessName: data.businessName,
    businessCategory: data.businessCategory,
    email: data.email,
    status: data.status,
    // Defaults to NOT live. An agent whose status hasn't loaded yet is unknown,
    // and showing "live" for an unknown state is the wrong way round — it tells
    // an owner their draft assistant is answering calls when it is not.
    isLive: data.status === "deployed",
    /** False until real data has arrived — render a skeleton, not a fallback. */
    loaded: data.loaded,
    agentConfig: data.agentConfig,
    overviewData: data.overviewData,
    contactsData: data.contactsData,
    updateWorkspace: setWorkspaceCache,
    revalidate: () => revalidateWorkspace(true),
  };
}
