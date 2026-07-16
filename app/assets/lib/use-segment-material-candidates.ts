"use client";

// Shared unified-candidate loader for the three "换素材" entry points
// (workbench segment cards, embedded FilmStrip, full-screen ReplacePanel).
//
// Contract (docs/authority/asset-understanding-and-segment-referencing.md §6.1):
// - First paint shows local groups (current / recommended / library) with no
//   external network dependency.
// - Public candidates load asynchronously afterwards; a provider failure only
//   affects the public group and never blanks out local candidates.
// - Endpoint failures are surfaced as real errors; there is no legacy fallback.

import { useCallback, useEffect, useRef, useState } from "react";
import { assetWorkspaceAdapter } from "./asset-workspace-adapter";
import type {
  SegmentMaterialOption,
  SegmentMaterialProviderStatus,
} from "./asset-workspace-types";

export type SegmentMaterialCandidatesState = {
  current: SegmentMaterialOption[];
  recommended: SegmentMaterialOption[];
  library: SegmentMaterialOption[];
  publicItems: SegmentMaterialOption[];
  providerStatuses: SegmentMaterialProviderStatus[];
  localLoading: boolean;
  localError: string;
  publicLoading: boolean;
  publicError: string;
  hasMorePublic: boolean;
  loadMorePublic: () => void;
  reload: () => void;
};

const EMPTY: SegmentMaterialCandidatesState = {
  current: [],
  recommended: [],
  library: [],
  publicItems: [],
  providerStatuses: [],
  localLoading: false,
  localError: "",
  publicLoading: false,
  publicError: "",
  hasMorePublic: false,
  loadMorePublic: () => {},
  reload: () => {},
};

function dedupeById(items: SegmentMaterialOption[]): SegmentMaterialOption[] {
  const seen = new Set<string>();
  const out: SegmentMaterialOption[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function useSegmentMaterialCandidates(args: {
  token: string | null;
  projectAssetId: number | null;
  segmentId: string | null;
  enabled: boolean;
}): SegmentMaterialCandidatesState {
  const { token, projectAssetId, segmentId, enabled } = args;
  const [state, setState] = useState<SegmentMaterialCandidatesState>(EMPTY);
  const cursorRef = useRef<string | null>(null);
  // Bumped on each reload so a stale in-flight response can't overwrite newer state.
  const runRef = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !token || !projectAssetId || !segmentId) {
      setState(EMPTY);
      return;
    }
    const run = ++runRef.current;
    cursorRef.current = null;
    setState({ ...EMPTY, localLoading: true, publicLoading: true });
    try {
      const local = await assetWorkspaceAdapter.loadSegmentMaterialCandidates(token, projectAssetId, segmentId, "local");
      if (run !== runRef.current) return;
      setState((prev) => ({
        ...prev,
        current: local.current ?? [],
        recommended: local.recommended,
        library: local.library,
        localLoading: false,
      }));
    } catch (cause) {
      if (run !== runRef.current) return;
      setState((prev) => ({
        ...prev,
        localLoading: false,
        publicLoading: false,
        localError: cause instanceof Error ? cause.message : "素材加载失败，请重试。",
      }));
      return;
    }

    // Public search runs after local paints; its failure is isolated.
    try {
      const remote = await assetWorkspaceAdapter.loadSegmentMaterialCandidates(token, projectAssetId, segmentId, "public");
      if (run !== runRef.current) return;
      cursorRef.current = remote.publicNextCursor ?? null;
      setState((prev) => ({
        ...prev,
        publicItems: remote.public ?? [],
        providerStatuses: remote.providerStatuses ?? [],
        publicLoading: false,
        hasMorePublic: Boolean(remote.publicNextCursor),
      }));
    } catch (cause) {
      if (run !== runRef.current) return;
      setState((prev) => ({
        ...prev,
        publicLoading: false,
        publicError: cause instanceof Error ? cause.message : "公共素材加载失败。",
      }));
    }
  }, [enabled, token, projectAssetId, segmentId]);

  const loadMorePublic = useCallback(async () => {
    if (!token || !projectAssetId || !segmentId) return;
    const cursor = cursorRef.current;
    if (!cursor) return;
    const run = runRef.current;
    setState((prev) => ({ ...prev, publicLoading: true, publicError: "" }));
    try {
      const remote = await assetWorkspaceAdapter.loadSegmentMaterialCandidates(token, projectAssetId, segmentId, "public", cursor);
      if (run !== runRef.current) return;
      cursorRef.current = remote.publicNextCursor ?? null;
      setState((prev) => ({
        ...prev,
        publicItems: dedupeById([...prev.publicItems, ...(remote.public ?? [])]),
        providerStatuses: remote.providerStatuses ?? prev.providerStatuses,
        publicLoading: false,
        hasMorePublic: Boolean(remote.publicNextCursor),
      }));
    } catch (cause) {
      if (run !== runRef.current) return;
      setState((prev) => ({
        ...prev,
        publicLoading: false,
        publicError: cause instanceof Error ? cause.message : "公共素材加载失败。",
      }));
    }
  }, [token, projectAssetId, segmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, loadMorePublic, reload: load };
}
