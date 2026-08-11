"use client";

// Shared Workspace & Console Client Cache:
// Eliminates screen-switching loading flickers across the whole app by providing
// instant in-memory and localStorage caching with silent background revalidation (SWR pattern).

import { useEffect, useState } from "react";
import { ownerFetch } from "./ownerFetch";

export interface WorkspaceCacheData {
  businessName: string | null;
  businessCategory: string | null;
  email: string | null;
  status: "deployed" | "draft" | string;
  isBusiness: boolean;
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

let memoryCache: WorkspaceCacheData = {
  businessName: "Shiro art and craft",
  businessCategory: "clinic",
  email: "shiro@mail.com",
  status: "deployed",
  isBusiness: true,
  lastUpdated: 0,
};

// Initialize memory cache from localStorage on browser boot
if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      memoryCache = { ...memoryCache, ...parsed };
    }
  } catch {
    /* ignore */
  }
}

type CacheListener = (data: WorkspaceCacheData) => void;
const listeners = new Set<CacheListener>();

function notifyListeners() {
  listeners.forEach((fn) => fn({ ...memoryCache }));
}

/** Get current cached workspace data synchronously (0ms latency). */
export function getWorkspaceCache(): WorkspaceCacheData {
  return { ...memoryCache };
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
  if (!force && !isStale && memoryCache.businessName) {
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
      if (ws.business_name) patch.businessName = ws.business_name;
      if (ws.business_category) patch.businessCategory = ws.business_category;
      if (ws.email) patch.email = ws.email;
      patch.isBusiness = ws.is_business ?? true;
    }

    if (agRes.ok) {
      const ag = await agRes.json();
      if (ag.status) patch.status = ag.status;
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

/** React hook to access workspace identity and status with 0ms first-render guarantee. */
export function useWorkspace() {
  const [data, setData] = useState<WorkspaceCacheData>(() => getWorkspaceCache());

  useEffect(() => {
    const handler: CacheListener = (fresh) => setData(fresh);
    listeners.add(handler);
    void revalidateWorkspace();

    return () => {
      listeners.delete(handler);
    };
  }, []);

  return {
    businessName: data.businessName || "Shiro art and craft",
    businessCategory: data.businessCategory,
    email: data.email || "shiro@mail.com",
    status: data.status || "deployed",
    isLive: (data.status || "deployed") === "deployed",
    agentConfig: data.agentConfig,
    overviewData: data.overviewData,
    contactsData: data.contactsData,
    updateWorkspace: setWorkspaceCache,
    revalidate: () => revalidateWorkspace(true),
  };
}
