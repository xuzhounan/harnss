import { useCallback, useMemo, useState } from "react";
import type { ToolId } from "@/components/ToolPicker";
import {
  DEFAULT_PANE_DRAWER_HEIGHT,
  MAX_PANE_DRAWER_HEIGHT,
  MIN_PANE_DRAWER_HEIGHT,
  clampWidthFractions,
  equalWidthFractions,
} from "@/lib/layout-constants";
import {
  type SplitAddRejectionReason,
  getSplitAddRejectionReason,
} from "@/lib/split-layout";

export interface PaneDrawerState {
  open: boolean;
  activeTab: ToolId | null;
  height: number;
}

export interface SplitAddSessionResult {
  ok: boolean;
  reason: SplitAddRejectionReason | null;
}

interface PruneSessionsResult {
  removedSessionIds: string[];
}

interface SplitAddSessionInput {
  sessionId: string;
  activeSessionId: string | null;
  maxPaneCount: number;
  position?: number;
}

export interface SplitViewState {
  enabled: boolean;
  visibleSessionIds: string[];
  paneCount: number;
  focusedSessionId: string | null;
  widthFractions: number[];
  getDrawerState: (sessionId: string) => PaneDrawerState;
  setFocusedSession: (sessionId: string | null) => void;
  setWidthFractions: (fractions: number[]) => void;
  requestAddSplitSession: (input: SplitAddSessionInput) => SplitAddSessionResult;
  removeSplitSession: (sessionId: string) => void;
  dismissSplitView: () => void;
  toggleToolTab: (sessionId: string, toolId: ToolId) => void;
  setDrawerHeight: (sessionId: string, height: number) => void;
  pruneSplitSessions: (validSessionIds: ReadonlySet<string>) => PruneSessionsResult;
  canShowSessionSplitAction: (sessionId: string | null | undefined, activeSessionId: string | null) => boolean;
}

const DEFAULT_DRAWER_STATE: PaneDrawerState = {
  open: false,
  activeTab: null,
  height: DEFAULT_PANE_DRAWER_HEIGHT,
};

function normalizeInsertIndex(position: number | undefined, visiblePaneCount: number): number {
  if (position === undefined) {
    return visiblePaneCount;
  }

  return Math.max(0, Math.min(position, visiblePaneCount));
}

function omitDrawerState(
  drawerStateByPaneId: Record<string, PaneDrawerState>,
  paneIdsToRemove: readonly string[],
): Record<string, PaneDrawerState> {
  if (paneIdsToRemove.length === 0) {
    return drawerStateByPaneId;
  }

  const nextDrawerStateByPaneId = { ...drawerStateByPaneId };
  for (const paneId of paneIdsToRemove) {
    delete nextDrawerStateByPaneId[paneId];
  }
  return nextDrawerStateByPaneId;
}

export function useSplitView(): SplitViewState {
  const [visibleSessionIds, setVisibleSessionIds] = useState<string[]>([]);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [widthFractions, setWidthFractionsState] = useState<number[]>([1]);
  const [drawerStateByPaneId, setDrawerStateByPaneId] = useState<Record<string, PaneDrawerState>>({});

  const paneCount = visibleSessionIds.length > 0 ? visibleSessionIds.length : 1;
  const enabled = visibleSessionIds.length > 1;

  const getDrawerState = useCallback((sessionId: string): PaneDrawerState => {
    return drawerStateByPaneId[sessionId] ?? DEFAULT_DRAWER_STATE;
  }, [drawerStateByPaneId]);

  const setFocusedSession = useCallback((sessionId: string | null) => {
    setFocusedSessionId(sessionId);
  }, []);

  const setWidthFractions = useCallback((fractions: number[]) => {
    setWidthFractionsState(clampWidthFractions(fractions));
  }, []);

  const requestAddSplitSession = useCallback(({
    sessionId,
    activeSessionId,
    maxPaneCount,
    position,
  }: SplitAddSessionInput): SplitAddSessionResult => {
    const currentVisibleSessionIds = visibleSessionIds.length > 0
      ? visibleSessionIds
      : activeSessionId
        ? [activeSessionId]
        : [];
    const reason = getSplitAddRejectionReason({
      sessionId,
      activeSessionId,
      visibleSessionIds: currentVisibleSessionIds,
      maxPaneCount,
    });

    if (reason) {
      return { ok: false, reason };
    }

    const normalizedSessionId = sessionId.trim();
    setVisibleSessionIds((currentSplitSessionIds) => {
      const baseVisibleSessionIds = currentSplitSessionIds.length > 0
        ? currentSplitSessionIds
        : activeSessionId
          ? [activeSessionId]
          : [];

      if (baseVisibleSessionIds.includes(normalizedSessionId)) {
        return currentSplitSessionIds;
      }

      const insertIndex = normalizeInsertIndex(position, baseVisibleSessionIds.length);
      const nextVisibleSessionIds = [...baseVisibleSessionIds];
      nextVisibleSessionIds.splice(insertIndex, 0, normalizedSessionId);
      setWidthFractionsState(equalWidthFractions(nextVisibleSessionIds.length));
      return nextVisibleSessionIds;
    });

    return { ok: true, reason: null };
  }, [visibleSessionIds]);

  const removeSplitSession = useCallback((sessionId: string) => {
    setVisibleSessionIds((currentVisibleSessionIds) => {
      if (!currentVisibleSessionIds.includes(sessionId)) {
        return currentVisibleSessionIds;
      }

      const nextVisibleSessionIds = currentVisibleSessionIds.filter((visibleSessionId) => visibleSessionId !== sessionId);
      const nextSplitSessionIds = nextVisibleSessionIds.length > 1 ? nextVisibleSessionIds : [];
      const paneIdsToClear = nextSplitSessionIds.length > 0 ? [sessionId] : currentVisibleSessionIds;

      setWidthFractionsState(nextSplitSessionIds.length > 0 ? equalWidthFractions(nextSplitSessionIds.length) : [1]);
      setFocusedSessionId((currentFocusedSessionId) =>
        currentFocusedSessionId !== null && !nextSplitSessionIds.includes(currentFocusedSessionId)
          ? null
          : currentFocusedSessionId,
      );
      setDrawerStateByPaneId((currentDrawerStateByPaneId) =>
        omitDrawerState(currentDrawerStateByPaneId, paneIdsToClear),
      );
      return nextSplitSessionIds;
    });
  }, []);

  const dismissSplitView = useCallback(() => {
    setVisibleSessionIds([]);
    setFocusedSessionId(null);
    setWidthFractionsState([1]);
    setDrawerStateByPaneId({});
  }, []);

  const toggleToolTab = useCallback((sessionId: string, toolId: ToolId) => {
    setDrawerStateByPaneId((currentDrawerStateByPaneId) => {
      const currentDrawerState = currentDrawerStateByPaneId[sessionId] ?? DEFAULT_DRAWER_STATE;
      if (currentDrawerState.activeTab === toolId) {
        return {
          ...currentDrawerStateByPaneId,
          [sessionId]: { ...currentDrawerState, open: false, activeTab: null },
        };
      }

      return {
        ...currentDrawerStateByPaneId,
        [sessionId]: { ...currentDrawerState, open: true, activeTab: toolId },
      };
    });
  }, []);

  const setDrawerHeight = useCallback((sessionId: string, height: number) => {
    const clampedHeight = Math.max(MIN_PANE_DRAWER_HEIGHT, Math.min(MAX_PANE_DRAWER_HEIGHT, height));
    setDrawerStateByPaneId((currentDrawerStateByPaneId) => {
      const currentDrawerState = currentDrawerStateByPaneId[sessionId] ?? DEFAULT_DRAWER_STATE;
      return {
        ...currentDrawerStateByPaneId,
        [sessionId]: { ...currentDrawerState, height: clampedHeight },
      };
    });
  }, []);

  const pruneSplitSessions = useCallback((validSessionIds: ReadonlySet<string>): PruneSessionsResult => {
    const removedSessionIds: string[] = [];

    setVisibleSessionIds((currentVisibleSessionIds) => {
      const nextVisibleSessionIds = currentVisibleSessionIds.filter((sessionId) => {
        const shouldKeep = validSessionIds.has(sessionId);
        if (!shouldKeep) {
          removedSessionIds.push(sessionId);
        }
        return shouldKeep;
      });

      if (nextVisibleSessionIds.length === currentVisibleSessionIds.length) {
        return currentVisibleSessionIds;
      }

      const nextSplitSessionIds = nextVisibleSessionIds.length > 1 ? nextVisibleSessionIds : [];
      const paneIdsToClear = nextSplitSessionIds.length > 0 ? removedSessionIds : currentVisibleSessionIds;

      setWidthFractionsState(nextSplitSessionIds.length > 0 ? equalWidthFractions(nextSplitSessionIds.length) : [1]);
      setDrawerStateByPaneId((currentDrawerStateByPaneId) =>
        omitDrawerState(currentDrawerStateByPaneId, paneIdsToClear),
      );
      setFocusedSessionId((currentFocusedSessionId) =>
        currentFocusedSessionId !== null && !nextSplitSessionIds.includes(currentFocusedSessionId)
          ? null
          : currentFocusedSessionId,
      );
      return nextSplitSessionIds;
    });

    return { removedSessionIds };
  }, []);

  const canShowSessionSplitAction = useCallback((sessionId: string | null | undefined, activeSessionId: string | null) => {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return false;
    }
    return normalizedSessionId !== activeSessionId && !visibleSessionIds.includes(normalizedSessionId);
  }, [visibleSessionIds]);

  return {
    enabled,
    visibleSessionIds,
    paneCount,
    focusedSessionId,
    widthFractions,
    getDrawerState,
    setFocusedSession,
    setWidthFractions,
    requestAddSplitSession,
    removeSplitSession,
    dismissSplitView,
    toggleToolTab,
    setDrawerHeight,
    pruneSplitSessions,
    canShowSessionSplitAction,
  };
}
