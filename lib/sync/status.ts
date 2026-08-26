"use client";

import { create } from "zustand";

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "local-only";

interface SyncStatusStore {
  phase: SyncPhase;
  pending: number;
  blocked: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  set: (patch: Partial<Omit<SyncStatusStore, "set">>) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  phase: "idle",
  pending: 0,
  blocked: 0,
  lastError: null,
  lastSyncedAt: null,
  set: (patch) => set(patch),
}));

export const syncStatus = {
  set: (patch: Parameters<SyncStatusStore["set"]>[0]) =>
    useSyncStatus.getState().set(patch),
  get: () => useSyncStatus.getState(),
};
