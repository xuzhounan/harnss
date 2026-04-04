import { useCallback, useMemo, useState } from "react";
import type { ToolId } from "@/components/ToolPicker";
import {
  DEFAULT_BOTTOM_TOOLS_HEIGHT,
  MAX_BOTTOM_TOOLS_HEIGHT,
  MIN_BOTTOM_TOOLS_HEIGHT,
  clampWidthFractions,
  equalWidthFractions,
} from "@/lib/layout-constants";
import {
  type SplitAddRejectionReason,
  getSplitAddRejectionReason,
} from "@/lib/split-layout";
import { replaceVisibleSessionId } from "@/lib/split-view-state";

type ContextualToolId = Extract<ToolId, "tasks" | "agents">;
export type SplitToolIslandDock = "top" | "bottom";

export interface SplitToolIsland {
  id: string;
  toolId: ToolId;
  sourceSessionId: string;
  dock: SplitToolIslandDock;
  persistKey: string;
}

export interface SplitToolColumn {
  id: string;
  islandIds: string[];
  splitRatios: number[];
}

interface SplitToolIslandMemory {
  islandId: string;
  persistKey: string;
  lastDock: SplitToolIslandDock;
  lastTopIndex: number | null;
  lastBottomIndex: number | null;
}

export type SplitTopRowItem =
  | { kind: "chat"; itemId: string; sessionId: string }
  | { kind: "tool-column"; itemId: string; column: SplitToolColumn; islands: SplitToolIsland[] };

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

interface TopColumnLocation {
  columnId: string;
  topRowIndex: number;
  stackIndex: number;
  islandCount: number;
}

export interface SplitViewState {
  enabled: boolean;
  visibleSessionIds: string[];
  paneCount: number;
  focusedSessionId: string | null;
  widthFractions: number[];
  topRowItems: SplitTopRowItem[];
  bottomToolIslands: SplitToolIsland[];
  bottomHeight: number;
  bottomWidthFractions: number[];
  setFocusedSession: (sessionId: string | null) => void;
  setWidthFractions: (fractions: number[]) => void;
  setTopToolColumnSplitRatios: (columnId: string, ratios: number[]) => void;
  setBottomHeight: (height: number) => void;
  setBottomWidthFractions: (fractions: number[]) => void;
  requestAddSplitSession: (input: SplitAddSessionInput) => SplitAddSessionResult;
  replaceSessionId: (previousSessionId: string, nextSessionId: string) => void;
  removeSplitSession: (sessionId: string) => void;
  dismissSplitView: () => void;
  openToolIsland: (sourceSessionId: string, toolId: ToolId, dock: SplitToolIslandDock, position?: number) => string | null;
  moveToolIsland: (islandId: string, dock: SplitToolIslandDock, position?: number) => void;
  openToolIslandInTopColumn: (sourceSessionId: string, toolId: ToolId, columnId: string, position?: number) => string | null;
  moveToolIslandToTopColumn: (islandId: string, columnId: string, position?: number) => void;
  closeToolIsland: (islandId: string) => void;
  getToolIslandForPane: (sessionId: string, toolId: ToolId) => SplitToolIsland | null;
  getPaneContextualTool: (sessionId: string) => ContextualToolId | null;
  togglePaneContextualTool: (sessionId: string, toolId: ContextualToolId) => void;
  pruneSplitSessions: (validSessionIds: ReadonlySet<string>) => PruneSessionsResult;
  canShowSessionSplitAction: (sessionId: string | null | undefined, activeSessionId: string | null) => boolean;
}

const PANEL_TOOL_IDS = new Set<ToolId>(["terminal", "browser", "git", "files", "project-files", "mcp"]);

function isPanelTool(toolId: ToolId): boolean {
  return PANEL_TOOL_IDS.has(toolId);
}

function makeChatItemId(sessionId: string): string {
  return `chat:${sessionId}`;
}

function makeToolColumnItemId(columnId: string): string {
  return `tool-column:${columnId}`;
}

function stripChatItemId(itemId: string): string {
  return itemId.startsWith("chat:") ? itemId.slice(5) : itemId;
}

function stripToolColumnItemId(itemId: string): string {
  return itemId.startsWith("tool-column:") ? itemId.slice(12) : itemId;
}

function normalizeInsertIndex(position: number | undefined, length: number): number {
  if (position === undefined) return length;
  return Math.max(0, Math.min(position, length));
}

function makeToolMemoryKey(sourceSessionId: string, toolId: ToolId): string {
  return `${sourceSessionId}:${toolId}`;
}

function findTopInsertIndexAfterSource(itemIds: string[], sourceSessionId: string): number {
  const chatIndex = itemIds.indexOf(makeChatItemId(sourceSessionId));
  return chatIndex >= 0 ? chatIndex + 1 : itemIds.length;
}

function findBottomToolIndex(itemIds: string[], islandId: string): number | null {
  const index = itemIds.indexOf(islandId);
  return index >= 0 ? index : null;
}

function findTopColumnLocation(
  topRowItemIds: string[],
  topToolColumnsById: Record<string, SplitToolColumn>,
  islandId: string,
): TopColumnLocation | null {
  for (let topRowIndex = 0; topRowIndex < topRowItemIds.length; topRowIndex++) {
    const itemId = topRowItemIds[topRowIndex]!;
    if (!itemId.startsWith("tool-column:")) continue;
    const columnId = stripToolColumnItemId(itemId);
    const column = topToolColumnsById[columnId];
    if (!column) continue;
    const stackIndex = column.islandIds.indexOf(islandId);
    if (stackIndex >= 0) {
      return {
        columnId,
        topRowIndex,
        stackIndex,
        islandCount: column.islandIds.length,
      };
    }
  }
  return null;
}

function removeIslandFromTopColumns(
  topRowItemIds: string[],
  topToolColumnsById: Record<string, SplitToolColumn>,
  islandId: string,
): {
  nextTopRowItemIds: string[];
  nextTopToolColumnsById: Record<string, SplitToolColumn>;
  location: TopColumnLocation | null;
} {
  const location = findTopColumnLocation(topRowItemIds, topToolColumnsById, islandId);
  if (!location) {
    return {
      nextTopRowItemIds: topRowItemIds,
      nextTopToolColumnsById: topToolColumnsById,
      location: null,
    };
  }

  const nextTopRowItemIds = [...topRowItemIds];
  const nextTopToolColumnsById = { ...topToolColumnsById };
  const column = nextTopToolColumnsById[location.columnId]!;
  const nextIslandIds = column.islandIds.filter((entry) => entry !== islandId);

  if (nextIslandIds.length === 0) {
    delete nextTopToolColumnsById[location.columnId];
    nextTopRowItemIds.splice(location.topRowIndex, 1);
  } else {
    nextTopToolColumnsById[location.columnId] = {
      ...column,
      islandIds: nextIslandIds,
      splitRatios: equalWidthFractions(nextIslandIds.length),
    };
  }

  return {
    nextTopRowItemIds,
    nextTopToolColumnsById,
    location,
  };
}

function buildToolIslandRecord(
  toolIslandsById: Record<string, SplitToolIsland>,
  sourceSessionId: string,
  toolId: ToolId,
  islandId: string,
  persistKey: string,
  dock: SplitToolIslandDock,
): SplitToolIsland {
  const existing = toolIslandsById[islandId];
  return existing ?? {
    id: islandId,
    toolId,
    sourceSessionId,
    dock,
    persistKey,
  };
}

export function useSplitView(): SplitViewState {
  const [visibleSessionIds, setVisibleSessionIds] = useState<string[]>([]);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [topRowItemIds, setTopRowItemIds] = useState<string[]>([]);
  const [topToolColumnsById, setTopToolColumnsById] = useState<Record<string, SplitToolColumn>>({});
  const [widthFractions, setWidthFractionsState] = useState<number[]>([1]);
  const [toolIslandsById, setToolIslandsById] = useState<Record<string, SplitToolIsland>>({});
  const [toolMemoriesByKey, setToolMemoriesByKey] = useState<Record<string, SplitToolIslandMemory>>({});
  const [bottomToolIslandIds, setBottomToolIslandIds] = useState<string[]>([]);
  const [bottomHeight, setBottomHeightState] = useState(DEFAULT_BOTTOM_TOOLS_HEIGHT);
  const [bottomWidthFractions, setBottomWidthFractionsState] = useState<number[]>([]);
  const [paneContextualTools, setPaneContextualTools] = useState<Record<string, ContextualToolId | null>>({});

  const topRowItems = useMemo<SplitTopRowItem[]>(() => {
    const items: SplitTopRowItem[] = [];
    for (const itemId of topRowItemIds) {
      if (itemId.startsWith("chat:")) {
        items.push({ kind: "chat", itemId, sessionId: stripChatItemId(itemId) });
        continue;
      }
      const columnId = stripToolColumnItemId(itemId);
      const column = topToolColumnsById[columnId];
      if (!column) continue;
      const islands = column.islandIds.flatMap((islandId) => {
        const island = toolIslandsById[islandId];
        return island ? [island] : [];
      });
      if (islands.length > 0) {
        items.push({ kind: "tool-column", itemId, column, islands });
      }
    }
    return items;
  }, [toolIslandsById, topRowItemIds, topToolColumnsById]);

  const bottomToolIslands = useMemo(
    () => bottomToolIslandIds.flatMap((islandId) => toolIslandsById[islandId] ? [toolIslandsById[islandId]!] : []),
    [bottomToolIslandIds, toolIslandsById],
  );

  const paneCount = topRowItems.length > 0 ? topRowItems.length : 1;
  const enabled = topRowItems.length > 1 || bottomToolIslands.length > 0;

  const setWidthFractions = useCallback((fractions: number[]) => {
    setWidthFractionsState(clampWidthFractions(fractions));
  }, []);

  const setTopToolColumnSplitRatios = useCallback((columnId: string, ratios: number[]) => {
    setTopToolColumnsById((current) => {
      const column = current[columnId];
      if (!column) return current;
      const nextRatios = ratios.length === column.islandIds.length
        ? clampWidthFractions(ratios)
        : equalWidthFractions(column.islandIds.length);
      return {
        ...current,
        [columnId]: {
          ...column,
          splitRatios: nextRatios,
        },
      };
    });
  }, []);

  const setBottomHeight = useCallback((height: number) => {
    setBottomHeightState(Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, height)));
  }, []);

  const setBottomWidthFractions = useCallback((fractions: number[]) => {
    setBottomWidthFractionsState(clampWidthFractions(fractions));
  }, []);

  const getToolIslandForPane = useCallback((sessionId: string, toolId: ToolId): SplitToolIsland | null => {
    for (const island of Object.values(toolIslandsById)) {
      if (island.sourceSessionId === sessionId && island.toolId === toolId) {
        return island;
      }
    }
    return null;
  }, [toolIslandsById]);

  const openToolIsland = useCallback((sourceSessionId: string, toolId: ToolId, dock: SplitToolIslandDock, position?: number) => {
    if (!isPanelTool(toolId)) return null;

    const memoryKey = makeToolMemoryKey(sourceSessionId, toolId);
    const memory = toolMemoriesByKey[memoryKey] ?? null;
    const existing = Object.values(toolIslandsById).find((island) => island.sourceSessionId === sourceSessionId && island.toolId === toolId) ?? null;
    const islandId = existing?.id ?? memory?.islandId ?? crypto.randomUUID();
    const persistKey = memory?.persistKey ?? `split-tool:${sourceSessionId}:${toolId}:${islandId}`;
    const resolvedDock = position === undefined && memory ? memory.lastDock : dock;
    const topRemoval = removeIslandFromTopColumns(topRowItemIds, topToolColumnsById, islandId);
    const nextBottomToolIslandIds = bottomToolIslandIds.filter((entry) => entry !== islandId);
    let nextTopRowItemIds = topRemoval.nextTopRowItemIds;
    const nextTopToolColumnsById = { ...topRemoval.nextTopToolColumnsById };
    let nextTopIndex = topRemoval.location?.topRowIndex ?? memory?.lastTopIndex ?? null;
    let nextBottomIndex = findBottomToolIndex(bottomToolIslandIds, islandId) ?? memory?.lastBottomIndex ?? null;

    if (resolvedDock === "top") {
      nextTopIndex = normalizeInsertIndex(
        position ?? memory?.lastTopIndex ?? findTopInsertIndexAfterSource(nextTopRowItemIds, sourceSessionId),
        nextTopRowItemIds.length,
      );
      const columnId = topRemoval.location?.islandCount === 1
        ? topRemoval.location.columnId
        : `tool-col:${islandId}`;
      nextTopToolColumnsById[columnId] = {
        id: columnId,
        islandIds: [islandId],
        splitRatios: [1],
      };
      nextTopRowItemIds = [...nextTopRowItemIds];
      nextTopRowItemIds.splice(nextTopIndex, 0, makeToolColumnItemId(columnId));
      setTopRowItemIds(nextTopRowItemIds);
      setTopToolColumnsById(nextTopToolColumnsById);
      setBottomToolIslandIds(nextBottomToolIslandIds);
      setWidthFractionsState(equalWidthFractions(nextTopRowItemIds.length));
    } else {
      nextBottomIndex = normalizeInsertIndex(
        position ?? memory?.lastBottomIndex ?? nextBottomToolIslandIds.length,
        nextBottomToolIslandIds.length,
      );
      const next = [...nextBottomToolIslandIds];
      next.splice(nextBottomIndex, 0, islandId);
      setTopRowItemIds(nextTopRowItemIds);
      setTopToolColumnsById(nextTopToolColumnsById);
      setBottomToolIslandIds(next);
      setWidthFractionsState(equalWidthFractions(nextTopRowItemIds.length));
      setBottomWidthFractionsState(equalWidthFractions(next.length));
    }

    setToolIslandsById((current) => ({
      ...current,
      [islandId]: {
        ...buildToolIslandRecord(current, sourceSessionId, toolId, islandId, persistKey, resolvedDock),
        dock: resolvedDock,
        persistKey,
      },
    }));
    setToolMemoriesByKey((current) => ({
      ...current,
      [memoryKey]: {
        islandId,
        persistKey,
        lastDock: resolvedDock,
        lastTopIndex: nextTopIndex,
        lastBottomIndex: nextBottomIndex,
      },
    }));

    return islandId;
  }, [bottomToolIslandIds, toolIslandsById, toolMemoriesByKey, topRowItemIds, topToolColumnsById]);

  const moveToolIsland = useCallback((islandId: string, dock: SplitToolIslandDock, position?: number) => {
    const island = toolIslandsById[islandId];
    if (!island) return;
    const memoryKey = makeToolMemoryKey(island.sourceSessionId, island.toolId);
    const memory = toolMemoriesByKey[memoryKey] ?? null;
    const topRemoval = removeIslandFromTopColumns(topRowItemIds, topToolColumnsById, islandId);
    const explicitPosition = dock === "top"
      ? (position ?? memory?.lastTopIndex ?? findTopInsertIndexAfterSource(topRemoval.nextTopRowItemIds, island.sourceSessionId))
      : (position ?? memory?.lastBottomIndex ?? bottomToolIslandIds.filter((entry) => entry !== islandId).length);
    void openToolIsland(island.sourceSessionId, island.toolId, dock, explicitPosition);
  }, [bottomToolIslandIds, openToolIsland, toolIslandsById, toolMemoriesByKey, topRowItemIds, topToolColumnsById]);

  const openToolIslandInTopColumn = useCallback((sourceSessionId: string, toolId: ToolId, columnId: string, position?: number) => {
    if (!isPanelTool(toolId)) return null;
    const targetColumn = topToolColumnsById[columnId];
    if (!targetColumn) return null;

    const memoryKey = makeToolMemoryKey(sourceSessionId, toolId);
    const memory = toolMemoriesByKey[memoryKey] ?? null;
    const existing = Object.values(toolIslandsById).find((island) => island.sourceSessionId === sourceSessionId && island.toolId === toolId) ?? null;
    const islandId = existing?.id ?? memory?.islandId ?? crypto.randomUUID();
    const persistKey = memory?.persistKey ?? `split-tool:${sourceSessionId}:${toolId}:${islandId}`;
    const topRemoval = removeIslandFromTopColumns(topRowItemIds, topToolColumnsById, islandId);
    const nextBottomToolIslandIds = bottomToolIslandIds.filter((entry) => entry !== islandId);
    const nextTopRowItemIds = topRemoval.nextTopRowItemIds;
    const nextTopToolColumnsById = { ...topRemoval.nextTopToolColumnsById };
    const resolvedColumn = nextTopToolColumnsById[columnId];
    if (!resolvedColumn) return null;

    const insertIndex = normalizeInsertIndex(position, resolvedColumn.islandIds.length);
    const nextIslandIds = [...resolvedColumn.islandIds];
    nextIslandIds.splice(insertIndex, 0, islandId);
    nextTopToolColumnsById[columnId] = {
      ...resolvedColumn,
      islandIds: nextIslandIds,
      splitRatios: equalWidthFractions(nextIslandIds.length),
    };
    const targetTopIndex = nextTopRowItemIds.indexOf(makeToolColumnItemId(columnId));

    setTopRowItemIds(nextTopRowItemIds);
    setTopToolColumnsById(nextTopToolColumnsById);
    setBottomToolIslandIds(nextBottomToolIslandIds);
    setWidthFractionsState(equalWidthFractions(nextTopRowItemIds.length));
    setToolIslandsById((current) => ({
      ...current,
      [islandId]: {
        ...buildToolIslandRecord(current, sourceSessionId, toolId, islandId, persistKey, "top"),
        dock: "top",
        persistKey,
      },
    }));
    setToolMemoriesByKey((current) => ({
      ...current,
      [memoryKey]: {
        islandId,
        persistKey,
        lastDock: "top",
        lastTopIndex: targetTopIndex >= 0 ? targetTopIndex : (current[memoryKey]?.lastTopIndex ?? null),
        lastBottomIndex: findBottomToolIndex(bottomToolIslandIds, islandId) ?? current[memoryKey]?.lastBottomIndex ?? memory?.lastBottomIndex ?? null,
      },
    }));

    return islandId;
  }, [bottomToolIslandIds, toolIslandsById, toolMemoriesByKey, topRowItemIds, topToolColumnsById]);

  const moveToolIslandToTopColumn = useCallback((islandId: string, columnId: string, position?: number) => {
    const island = toolIslandsById[islandId];
    if (!island) return;
    void openToolIslandInTopColumn(island.sourceSessionId, island.toolId, columnId, position);
  }, [openToolIslandInTopColumn, toolIslandsById]);

  const closeToolIsland = useCallback((islandId: string) => {
    const island = toolIslandsById[islandId];
    if (island) {
      const memoryKey = makeToolMemoryKey(island.sourceSessionId, island.toolId);
      const topLocation = findTopColumnLocation(topRowItemIds, topToolColumnsById, islandId);
      const bottomIndex = findBottomToolIndex(bottomToolIslandIds, islandId);
      setToolMemoriesByKey((current) => ({
        ...current,
        [memoryKey]: {
          islandId,
          persistKey: current[memoryKey]?.persistKey ?? island.persistKey,
          lastDock: island.dock,
          lastTopIndex: topLocation?.topRowIndex ?? current[memoryKey]?.lastTopIndex ?? null,
          lastBottomIndex: bottomIndex ?? current[memoryKey]?.lastBottomIndex ?? null,
        },
      }));
    }

    const topRemoval = removeIslandFromTopColumns(topRowItemIds, topToolColumnsById, islandId);
    const nextBottomToolIslandIds = bottomToolIslandIds.filter((entry) => entry !== islandId);
    setTopRowItemIds(topRemoval.nextTopRowItemIds);
    setTopToolColumnsById(topRemoval.nextTopToolColumnsById);
    setBottomToolIslandIds(nextBottomToolIslandIds);
    setWidthFractionsState(equalWidthFractions(topRemoval.nextTopRowItemIds.length));
    setBottomWidthFractionsState(equalWidthFractions(nextBottomToolIslandIds.length));
    setToolIslandsById((current) => {
      if (!(islandId in current)) return current;
      const next = { ...current };
      delete next[islandId];
      return next;
    });
  }, [bottomToolIslandIds, toolIslandsById, topRowItemIds, topToolColumnsById]);

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
    if (reason) return { ok: false, reason };

    const normalizedSessionId = sessionId.trim();
    const baseTopRowItemIds = topRowItemIds.length > 0
      ? topRowItemIds
      : currentVisibleSessionIds.map(makeChatItemId);

    if (baseTopRowItemIds.includes(makeChatItemId(normalizedSessionId))) {
      return { ok: true, reason: null };
    }

    const insertIndex = normalizeInsertIndex(position, baseTopRowItemIds.length);
    const nextTopRowItemIds = [...baseTopRowItemIds];
    nextTopRowItemIds.splice(insertIndex, 0, makeChatItemId(normalizedSessionId));

    const chatInsertIndex = nextTopRowItemIds
      .slice(0, insertIndex + 1)
      .filter((itemId) => itemId.startsWith("chat:")).length - 1;
    const nextVisibleSessionIds = [...currentVisibleSessionIds];
    nextVisibleSessionIds.splice(chatInsertIndex, 0, normalizedSessionId);

    setVisibleSessionIds(nextVisibleSessionIds);
    setTopRowItemIds(nextTopRowItemIds);
    setWidthFractionsState(equalWidthFractions(nextTopRowItemIds.length));
    return { ok: true, reason: null };
  }, [topRowItemIds, visibleSessionIds]);

  const replaceSessionId = useCallback((previousSessionId: string, nextSessionId: string) => {
    const previousId = previousSessionId.trim();
    const nextId = nextSessionId.trim();
    if (!previousId || !nextId || previousId === nextId) return;

    setVisibleSessionIds((current) => replaceVisibleSessionId(current, previousId, nextId));
    setTopRowItemIds((current) => current.map((itemId) => itemId === makeChatItemId(previousId) ? makeChatItemId(nextId) : itemId));
    setFocusedSessionId((current) => current === previousId ? nextId : current);
    setPaneContextualTools((current) => {
      if (!(previousId in current)) return current;
      const next = { ...current };
      next[nextId] = next[previousId] ?? null;
      delete next[previousId];
      return next;
    });
    setToolIslandsById((current) => {
      const entries = Object.entries(current).map(([id, island]) => (
        island.sourceSessionId === previousId
          ? [id, { ...island, sourceSessionId: nextId, persistKey: `split-tool:${nextId}:${island.toolId}:${id}` }]
          : [id, island]
      ));
      return Object.fromEntries(entries);
    });
    setToolMemoriesByKey((current) => {
      const next: Record<string, SplitToolIslandMemory> = {};
      for (const [key, memory] of Object.entries(current)) {
        const [sessionId, ...toolIdParts] = key.split(":");
        const toolId = toolIdParts.join(":") as ToolId;
        if (sessionId === previousId) {
          next[makeToolMemoryKey(nextId, toolId)] = {
            ...memory,
            persistKey: `split-tool:${nextId}:${toolId}:${memory.islandId}`,
          };
        } else {
          next[key] = memory;
        }
      }
      return next;
    });
  }, []);

  const removeSplitSession = useCallback((sessionId: string) => {
    const chatItemId = makeChatItemId(sessionId);
    const toolIslandIdsToRemove = Object.values(toolIslandsById)
      .filter((island) => island.sourceSessionId === sessionId)
      .map((island) => island.id);

    const nextTopRowItemIds = topRowItemIds.filter((entry) => entry !== chatItemId);
    const nextTopToolColumnsById: Record<string, SplitToolColumn> = {};
    for (const [columnId, column] of Object.entries(topToolColumnsById)) {
      const nextIslandIds = column.islandIds.filter((islandId) => !toolIslandIdsToRemove.includes(islandId));
      if (nextIslandIds.length > 0) {
        nextTopToolColumnsById[columnId] = {
          ...column,
          islandIds: nextIslandIds,
          splitRatios: equalWidthFractions(nextIslandIds.length),
        };
      }
    }
    const nextPrunedTopRowItemIds = nextTopRowItemIds.filter((itemId) => {
      if (!itemId.startsWith("tool-column:")) return true;
      return !!nextTopToolColumnsById[stripToolColumnItemId(itemId)];
    });
    const nextBottomToolIslandIds = bottomToolIslandIds.filter((entry) => !toolIslandIdsToRemove.includes(entry));

    setVisibleSessionIds((current) => current.filter((entry) => entry !== sessionId));
    setTopRowItemIds(nextPrunedTopRowItemIds);
    setTopToolColumnsById(nextTopToolColumnsById);
    setBottomToolIslandIds(nextBottomToolIslandIds);
    setWidthFractionsState(equalWidthFractions(nextPrunedTopRowItemIds.length));
    setBottomWidthFractionsState(equalWidthFractions(nextBottomToolIslandIds.length));
    setToolIslandsById((current) => {
      if (toolIslandIdsToRemove.length === 0) return current;
      const next = { ...current };
      for (const islandId of toolIslandIdsToRemove) delete next[islandId];
      return next;
    });
    setToolMemoriesByKey((current) => {
      const next: Record<string, SplitToolIslandMemory> = {};
      for (const [key, memory] of Object.entries(current)) {
        if (!key.startsWith(`${sessionId}:`)) {
          next[key] = memory;
        }
      }
      return next;
    });
    setPaneContextualTools((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setFocusedSessionId((current) => current === sessionId ? null : current);
  }, [bottomToolIslandIds, toolIslandsById, topRowItemIds, topToolColumnsById]);

  const dismissSplitView = useCallback(() => {
    setVisibleSessionIds([]);
    setFocusedSessionId(null);
    setTopRowItemIds([]);
    setTopToolColumnsById({});
    setWidthFractionsState([1]);
    setToolIslandsById({});
    setToolMemoriesByKey({});
    setBottomToolIslandIds([]);
    setBottomHeightState(DEFAULT_BOTTOM_TOOLS_HEIGHT);
    setBottomWidthFractionsState([]);
    setPaneContextualTools({});
  }, []);

  const getPaneContextualTool = useCallback((sessionId: string): ContextualToolId | null => {
    return paneContextualTools[sessionId] ?? null;
  }, [paneContextualTools]);

  const togglePaneContextualTool = useCallback((sessionId: string, toolId: ContextualToolId) => {
    setPaneContextualTools((current) => ({
      ...current,
      [sessionId]: current[sessionId] === toolId ? null : toolId,
    }));
  }, []);

  const pruneSplitSessions = useCallback((validSessionIds: ReadonlySet<string>): PruneSessionsResult => {
    const removedSessionIds = visibleSessionIds.filter((sessionId) => !validSessionIds.has(sessionId));
    for (const sessionId of removedSessionIds) {
      removeSplitSession(sessionId);
    }
    return { removedSessionIds };
  }, [removeSplitSession, visibleSessionIds]);

  const canShowSessionSplitAction = useCallback((sessionId: string | null | undefined, activeSessionId: string | null) => {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) return false;
    return normalizedSessionId !== activeSessionId && !visibleSessionIds.includes(normalizedSessionId);
  }, [visibleSessionIds]);

  return {
    enabled,
    visibleSessionIds,
    paneCount,
    focusedSessionId,
    widthFractions,
    topRowItems,
    bottomToolIslands,
    bottomHeight,
    bottomWidthFractions,
    setFocusedSession: setFocusedSessionId,
    setWidthFractions,
    setTopToolColumnSplitRatios,
    setBottomHeight,
    setBottomWidthFractions,
    requestAddSplitSession,
    replaceSessionId,
    removeSplitSession,
    dismissSplitView,
    openToolIsland,
    moveToolIsland,
    openToolIslandInTopColumn,
    moveToolIslandToTopColumn,
    closeToolIsland,
    getToolIslandForPane,
    getPaneContextualTool,
    togglePaneContextualTool,
    pruneSplitSessions,
    canShowSessionSplitAction,
  };
}
