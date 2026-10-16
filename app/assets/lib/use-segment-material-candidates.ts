"use client";

// Shared unified-candidate loader for the three "换素材" entry points
// (workbench segment cards, embedded FilmStrip, full-screen ReplacePanel).
//
// Contract (MultiMix-Backend/docs/authority/asset-understanding-and-segment-referencing.md §6.1):
// - Candidates come only from the user's own library (current / recommended /
//   library). Public stock material was retired on 2026-10-15, so there is no
//   external network dependency and no public group.
// - Endpoint failures are surfaced as real errors; there is no legacy fallback.

import { useCallback, useEffect, useRef, useState } from "react";
import { assetWorkspaceAdapter } from "./asset-workspace-adapter";
import type { SegmentMaterialOption } from "./asset-workspace-types";

export type SegmentMaterialCandidatesState = {
  current: SegmentMaterialOption[];
  recommended: SegmentMaterialOption[];
  library: SegmentMaterialOption[];
  localLoading: boolean;
  localError: string;
  reload: () => void;
};

const EMPTY: SegmentMaterialCandidatesState = {
  current: [],
  recommended: [],
  library: [],
  localLoading: false,
  localError: "",
  reload: () => {},
};

export function useSegmentMaterialCandidates(args: {
  token: string | null;
  projectAssetId: number | null;
  segmentId: string | null;
  enabled: boolean;
}): SegmentMaterialCandidatesState {
  const { token, projectAssetId, segmentId, enabled } = args;
  const [state, setState] = useState<SegmentMaterialCandidatesState>(EMPTY);
  // Bumped on each reload so a stale in-flight response can't overwrite newer state.
  const runRef = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !token || !projectAssetId || !segmentId) {
      setState(EMPTY);
      return;
    }
    const run = ++runRef.current;
    setState({ ...EMPTY, localLoading: true });
    try {
      const local = await assetWorkspaceAdapter.loadSegmentMaterialCandidates(token, projectAssetId, segmentId);
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
        localError: cause instanceof Error ? cause.message : "素材加载失败，请重试。",
      }));
    }
  }, [enabled, token, projectAssetId, segmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
