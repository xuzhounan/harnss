import React, { useCallback, useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { ArrowUp, PanelLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { normalizeRatios } from "@/hooks/useSettings";
import { useAppOrchestrator } from "@/hooks/useAppOrchestrator";
import { useSpaceTheme } from "@/hooks/useSpaceTheme";
import { useGlassTheme } from "@/hooks/useGlassTheme";
import { usePaneController, type PaneControllerContext } from "@/hooks/usePaneController";
import { useToolIslandContext } from "@/hooks/useToolIslandContext";
import { usePanelResize } from "@/hooks/usePanelResize";
import {
  ISLAND_CONTROL_RADIUS,
  ISLAND_GAP,
  ISLAND_PANEL_GAP,
  ISLAND_RADIUS,
  MIN_TOOLS_PANEL_WIDTH,
  RESIZE_HANDLE_WIDTH_ISLAND,
  TOOL_PICKER_WIDTH_ISLAND,
  equalWidthFractions,
  getMinChatWidth,
} from "@/lib/layout-constants";
import type { GrabbedElement } from "@/types/ui";
import { AppSidebar } from "./AppSidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatView } from "./ChatView";
import { BottomComposer } from "./BottomComposer";
import { ToolPicker } from "./ToolPicker";
import { PANEL_TOOLS_MAP, type ToolId } from "./ToolPicker";
import { WelcomeScreen } from "./WelcomeScreen";
import { WelcomeWizard } from "./welcome/WelcomeWizard";
import { WELCOME_COMPLETED_KEY } from "./welcome/shared";
import { PanelDockControls } from "./PanelDockControls";
import { PanelDockPreview } from "./PanelDockPreview";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { SettingsView } from "./SettingsView";
import { CodexAuthDialog } from "./CodexAuthDialog";
import { ACPAuthDialog } from "./ACPAuthDialog";
import { JiraBoardPanel } from "./JiraBoardPanel";
import { isMac, isWindows } from "@/lib/utils";
import { SplitHandle } from "./split/SplitHandle";
import { SplitDropZone } from "./split/SplitDropZone";
import { SplitPaneHost } from "./split/SplitPaneHost";
import { SplitChatPane } from "./split/SplitChatPane";
import { MainTopToolArea } from "./workspace/MainTopToolArea";
import { MainBottomToolDock } from "./workspace/MainBottomToolDock";
import { ToolIslandContent } from "./workspace/ToolIslandContent";
import { RightPanel } from "./workspace/RightPanel";
import { DRAFT_ID } from "@/hooks/session/types";
import { usePaneResize } from "@/hooks/usePaneResize";
import { useToolColumnResize } from "@/hooks/useToolColumnResize";
import { useBottomHeightResize } from "@/hooks/useBottomHeightResize";
import { useSpaceSwitchCooldown } from "@/hooks/useSpaceSwitchCooldown";
import { useMainToolPaneResize } from "@/hooks/useMainToolPaneResize";
import { useJiraBoard } from "@/hooks/useJiraBoard";
import { useSplitDragDrop } from "@/hooks/useSplitDragDrop";
import { useMainToolWorkspace } from "@/hooks/useMainToolWorkspace";
import {
  DEFAULT_TOOL_PREFERRED_WIDTH,
  MIN_CHAT_WIDTH_SPLIT,
  SPLIT_HANDLE_WIDTH,
  TOOL_PREFERRED_WIDTHS,
} from "@/lib/layout-constants";
import { getMaxVisibleSplitPaneCount } from "@/lib/split-layout";
import { getStoredProjectGitCwd } from "@/lib/space-projects";
import {
  getHorizontalInsertSide,
  getRequiredToolIslandsWidth,
  getToolColumnDropIntent,
  isNearBottomDockZone,
} from "@/lib/workspace-drag";
import type { InstalledAgent } from "@/types";

export function AppLayout() {
  const o = useAppOrchestrator();
  const {
    sidebar, projectManager, spaceManager, manager, settings, resolvedTheme,
    agents, selectedAgent, saveAgent, deleteAgent, handleAgentChange,
    lockedEngine, lockedAgentId,
    activeProjectId, activeProjectPath, activeSpaceProject, activeSpaceTerminalCwd, showThinking,
    hasProjects, isSpaceSwitching, showToolPicker, hasRightPanel,
    activeTodos, bgAgents, hasTodos, hasAgents, availableContextual,
    glassSupported, macLiquidGlassSupported, liveMacBackgroundEffect, devFillEnabled, jiraBoardEnabled,
    showSettings, setShowSettings,
    scrollToMessageId, setScrollToMessageId,
    chatSearchOpen, setChatSearchOpen,
    spaceTerminals, activeSpaceTerminals,
    handleToggleTool, handleToolReorder, handleNewChat, handleSend,
    handleModelChange, handlePermissionModeChange, handlePlanModeChange,
    handleClaudeModelEffortChange, handleAgentWorktreeChange, handleStop, handleSelectSession,
    handleSendQueuedNow, handleUnqueueMessage,
    handleCreateProject, handleImportCCSession, handleNavigateToMessage,
    handleStartCreateSpace, handleConfirmCreateSpace, handleCancelCreateSpace,
    handleUpdateSpace, handleDeleteSpace, handleMoveProjectToSpace,
    draftSpaceId,
    handleSeedDevExampleSpaceData,
    splitView,
  } = o;

  // Draft is a real space — activeSpace already points to it, no synthetic needed
  const glassOverlayStyle = useSpaceTheme(
    spaceManager.activeSpace,
    resolvedTheme,
    glassSupported && settings.transparency,
    liveMacBackgroundEffect,
  );
  const spaceOpacity = spaceManager.activeSpace?.color.opacity ?? 1;
  const glassTheme = useGlassTheme({
    isGlassSupported: glassSupported,
    transparency: settings.transparency,
    resolvedTheme,
    liveMacBackgroundEffect,
    isIsland: settings.islandLayout,
    spaceOpacity,
  });
  const { isLightGlass, isNativeGlass, chatFadeStrength, titlebarSurfaceColor, topFadeBackground, bottomFadeBackground } = glassTheme;

  // ── Window focus tracking (subtle veil on macOS liquid glass when unfocused) ──
  const [windowFocused, setWindowFocused] = useState(true);
  useEffect(() => {
    if (!isNativeGlass) return;
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [isNativeGlass]);

  // ── Welcome wizard (first-run onboarding) ──

  const [welcomeCompleted, setWelcomeCompleted] = useState(
    () => localStorage.getItem(WELCOME_COMPLETED_KEY) === "true",
  );

  const handleWelcomeComplete = useCallback(() => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, "true");
    setWelcomeCompleted(true);
  }, []);

  const handleReplayWelcome = useCallback(() => {
    localStorage.removeItem(WELCOME_COMPLETED_KEY);
    setWelcomeCompleted(false);
    setShowSettings(false);
  }, [setShowSettings]);

  // ── Element Grab state (browser inspector → chat context) ──

  const [grabbedElements, setGrabbedElements] = useState<GrabbedElement[]>([]);

  const handleElementGrab = useCallback((element: GrabbedElement) => {
    setGrabbedElements((prev) => [...prev, element]);
  }, []);

  const handleRemoveGrabbedElement = useCallback((id: string) => {
    setGrabbedElements((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ── File preview overlay state ──

  const [previewFile, setPreviewFile] = useState<{ path: string; sourceRect: DOMRect } | null>(null);

  const handlePreviewFile = useCallback((filePath: string, sourceRect: DOMRect) => {
    setPreviewFile({ path: filePath, sourceRect });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  const jiraBoard = useJiraBoard({
    jiraBoardEnabled,
    activeSpaceId: spaceManager.activeSpaceId,
    activeProjectId,
    activeSessionId: manager.activeSessionId,
    projects: projectManager.projects,
    handleSend,
    handleNewChat,
  });
  const { jiraBoardProjectId, jiraBoardProject, setJiraBoardProjectForSpace, handleToggleProjectJiraBoard, handleCreateTaskFromJiraIssue } = jiraBoard;
  const [pendingSplitPaneSend, setPendingSplitPaneSend] = useState<{
    sessionId: string;
    text: string;
    images?: Parameters<typeof handleSend>[1];
    displayText?: string;
  } | null>(null);


  // Wrap handleSend to clear grabbed elements after sending
  const wrappedHandleSend = useCallback(
    async (...args: Parameters<typeof handleSend>) => {
      await handleSend(...args);
      setGrabbedElements([]);
    },
    [handleSend],
  );

  const handleOpenNewChat = useCallback(
    async (projectId: string) => {
      const project = projectManager.projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }
      splitView.dismissSplitView();
      await handleNewChat(projectId);
    },
    [handleNewChat, projectManager.projects, setJiraBoardProjectForSpace, splitView.dismissSplitView],
  );

  const handleComposerClear = useCallback(
    async () => {
      const projectId = activeProjectId ?? activeSpaceProject?.id;
      if (!projectId) return;
      setGrabbedElements([]);
      await handleOpenNewChat(projectId);
    },
    [activeProjectId, activeSpaceProject, handleOpenNewChat, setGrabbedElements],
  );

  const handleSidebarSelectSession = useCallback(
    (sessionId: string) => {
      const session = manager.sessions.find((item) => item.id === sessionId);
      const project = session
        ? projectManager.projects.find((item) => item.id === session.projectId)
        : null;
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }
      splitView.dismissSplitView();
      handleSelectSession(sessionId);
    },
    [handleSelectSession, manager.sessions, projectManager.projects, setJiraBoardProjectForSpace, splitView.dismissSplitView],
  );


  useEffect(() => {
    if (!pendingSplitPaneSend) return;
    if (manager.activeSessionId !== pendingSplitPaneSend.sessionId) return;

    const nextSend = pendingSplitPaneSend;
    setPendingSplitPaneSend(null);

    void manager.send(nextSend.text, nextSend.images, nextSend.displayText);
  }, [manager.activeSessionId, manager.send, pendingSplitPaneSend]);

  const isIsland = settings.islandLayout;
  const minChatWidth = getMinChatWidth(isIsland);
  const splitGap = isIsland ? RESIZE_HANDLE_WIDTH_ISLAND / 2 : 0.5;
  const islandRadius = isWindows ? 8 : ISLAND_RADIUS;
  const islandControlRadius = isWindows ? 7 : ISLAND_CONTROL_RADIUS;
  const islandLayoutVars = isIsland
    ? {
        "--island-gap": `${ISLAND_GAP}px`,
        "--island-panel-gap": `${ISLAND_PANEL_GAP}px`,
        "--island-radius": `${islandRadius}px`,
        "--island-control-radius": `${islandControlRadius}px`,
        "--tool-picker-strip-width": `${TOOL_PICKER_WIDTH_ISLAND - ISLAND_PANEL_GAP}px`,
      } as React.CSSProperties
    : undefined;

  const resize = usePanelResize({
    settings,
    isIsland,
    hasRightPanel,
    activeSessionId: manager.activeSessionId,
    activeProjectId,
  });
  const {
    isResizing, contentRef, rightPanelRef, toolsColumnRef,
    handleResizeStart, handleRightSplitStart,
    pickerW, handleW,
  } = resize;

  // ── Split view resize ──
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);
  const [availableSplitWidth, setAvailableSplitWidth] = useState(0);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const updateAvailableSplitWidth = () => {
      setAvailableSplitWidth(element.getBoundingClientRect().width);
    };

    updateAvailableSplitWidth();
    const resizeObserver = new ResizeObserver(updateAvailableSplitWidth);
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
    };
  }, [contentRef]);

  const maxSplitPaneCount = useMemo(
    () => getMaxVisibleSplitPaneCount(availableSplitWidth),
    [availableSplitWidth],
  );

  const paneResize = usePaneResize({
    widthFractions: splitView.widthFractions,
    setWidthFractions: splitView.setWidthFractions,
    containerRef: splitContainerRef,
  });

  const mainWorkspaceProjectId = activeSpaceProject?.id ?? activeProjectId ?? null;
  const mainCombinedWorkspaceWidthRef = useRef(0);
  const mainToolWorkspace = useMainToolWorkspace(mainWorkspaceProjectId, {
    activeToolIds: settings.activeTools,
    toolOrder: settings.toolOrder,
    bottomTools: settings.bottomTools,
    bottomHeight: settings.bottomToolsHeight,
    bottomWidthFractions: settings.bottomToolsSplitRatios,
  }, mainCombinedWorkspaceWidthRef);
  const mainToolAreaRef = useRef<HTMLDivElement>(null);
  const mainTopToolColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mainBottomRowRef = useRef<HTMLDivElement>(null);
  const mainToolPaneResize = useMainToolPaneResize(mainToolWorkspace, mainToolAreaRef);
  const mainBottomPaneResize = usePaneResize({
    widthFractions: mainToolWorkspace.bottomWidthFractions,
    setWidthFractions: mainToolWorkspace.setBottomWidthFractions,
    containerRef: mainBottomRowRef,
  });

  const isSplitActive = splitView.enabled;
  const splitPaneSessionIds = splitView.visibleSessionIds;
  const splitTopRowItems = splitView.topRowItems;
  const splitBottomToolIslands = splitView.bottomToolIslands;
  const previousActiveSplitSessionIdRef = useRef<string | null>(manager.activeSessionId);

  const queueSplitPaneSendAfterSwitch = useCallback(
    async (sessionId: string, text: string, images?: Parameters<typeof handleSend>[1], displayText?: string) => {
      setPendingSplitPaneSend({ sessionId, text, images, displayText });
      await manager.switchSession(sessionId);
    },
    [manager.switchSession],
  );

  const createSplitPaneDraftSession = useCallback(
    async (replacedSessionId: string, projectId: string, agent: InstalledAgent | null) => {
      const wantedEngine = agent?.engine ?? "claude";
      const wantedModel = settings.getModelForEngine(wantedEngine) || undefined;
      await manager.createSession(projectId, {
        model: wantedModel,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: wantedEngine === "claude" ? settings.claudeEffort : undefined,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
      splitView.replaceSessionId(replacedSessionId, DRAFT_ID);
      splitView.setFocusedSession(DRAFT_ID);
    },
    [manager.createSession, settings, splitView],
  );

  // ── Drag-and-drop from sidebar ──
  const visibleSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (isSplitActive) {
      for (const sessionId of splitView.visibleSessionIds) ids.add(sessionId);
      return ids;
    }

    if (manager.activeSessionId) ids.add(manager.activeSessionId);
    return ids;
  }, [isSplitActive, manager.activeSessionId, splitView.visibleSessionIds]);

  useEffect(() => {
    if (!isSplitActive) {
      if (splitView.focusedSessionId !== null) {
        splitView.setFocusedSession(null);
      }
      return;
    }

    if (splitView.focusedSessionId && visibleSessionIds.has(splitView.focusedSessionId)) {
      return;
    }

    splitView.setFocusedSession(splitPaneSessionIds[0] ?? null);
  }, [
    isSplitActive,
    splitPaneSessionIds,
    splitView.focusedSessionId,
    splitView.setFocusedSession,
    visibleSessionIds,
  ]);

  useEffect(() => {
    const previousActiveSessionId = previousActiveSplitSessionIdRef.current;
    const nextActiveSessionId = manager.activeSessionId;
    previousActiveSplitSessionIdRef.current = nextActiveSessionId;

    if (!previousActiveSessionId || !nextActiveSessionId || previousActiveSessionId === nextActiveSessionId) {
      return;
    }

    if (!splitView.visibleSessionIds.includes(previousActiveSessionId)) {
      return;
    }

    const validSessionIds = new Set(manager.sessions.map((session) => session.id));
    if (validSessionIds.has(previousActiveSessionId)) {
      return;
    }

    splitView.replaceSessionId(previousActiveSessionId, nextActiveSessionId);
  }, [manager.activeSessionId, manager.sessions, splitView.replaceSessionId, splitView.visibleSessionIds]);

  useEffect(() => {
    const validSessionIds = new Set(manager.sessions.map((session) => session.id));
    if (manager.activeSessionId) {
      validSessionIds.add(manager.activeSessionId);
    }
    splitView.pruneSplitSessions(validSessionIds);
  }, [manager.activeSessionId, manager.sessions, splitView.pruneSplitSessions]);

  const requestAddSplitSession = useCallback((sessionId: string, position?: number) => {
    const result = splitView.requestAddSplitSession({
      sessionId,
      activeSessionId: manager.activeSessionId,
      maxPaneCount: maxSplitPaneCount,
      position,
    });

    if (!result.ok && result.reason === "insufficient-width") {
      toast.error("Widen the window to add another split pane.");
    }

    return result.ok;
  }, [manager.activeSessionId, maxSplitPaneCount, splitView]);

  const handleCloseSplitPane = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      splitView.dismissSplitView();
      return;
    }

    if (sessionId !== manager.activeSessionId) {
      splitView.removeSplitSession(sessionId);
      return;
    }

    const paneIndex = splitView.visibleSessionIds.indexOf(sessionId);
    const remainingSessionIds = splitView.visibleSessionIds.filter((visibleSessionId) => visibleSessionId !== sessionId);
    const replacementSessionId = remainingSessionIds[paneIndex] ?? remainingSessionIds[paneIndex - 1] ?? remainingSessionIds[0] ?? null;

    splitView.removeSplitSession(sessionId);
    if (!replacementSessionId) {
      return;
    }

    await manager.switchSession(replacementSessionId);
  }, [
    manager.activeSessionId,
    manager.switchSession,
    splitView.removeSplitSession,
    splitView.visibleSessionIds,
  ]);

  const splitDragDrop = useSplitDragDrop({
    paneCount: splitView.paneCount,
    canAcceptDrop: !!manager.activeSessionId && splitView.topRowItems.length < maxSplitPaneCount,
    containerRef: splitContainerRef,
    widthFractions: splitView.widthFractions,
    onDrop: (sessionId, position) => {
      requestAddSplitSession(sessionId, position);
    },
    visibleSessionIds,
  });
  const previewDropPosition = splitDragDrop.dragState.isDragging ? splitDragDrop.dragState.dropPosition : null;
  const [splitToolDrag, setSplitToolDrag] = useState<{
    toolId: ToolId;
    sourceSessionId: string;
    islandId: string | null;
    targetArea: "top" | "top-stack" | "bottom" | null;
    targetIndex: number | null;
    targetColumnId: string | null;
  } | null>(null);
  const [isMainToolAreaResizing, setIsMainToolAreaResizing] = useState(false);
  const splitToolLabel = splitToolDrag ? PANEL_TOOLS_MAP[splitToolDrag.toolId]?.label ?? splitToolDrag.toolId : null;
  const [mainToolDrag, setMainToolDrag] = useState<{
    toolId: ToolId;
    islandId: string | null;
    targetArea: "top" | "top-stack" | "bottom" | null;
    targetIndex: number | null;
    targetColumnId: string | null;
  } | null>(null);
  const resetMainToolDrag = useCallback(() => {
    setMainToolDrag(null);
  }, []);
  const resetSplitToolDrag = useCallback(() => {
    setSplitToolDrag(null);
  }, []);
  const commitSplitToolDrop = useCallback(() => {
    if (!splitToolDrag || splitToolDrag.targetArea === null || splitToolDrag.targetIndex === null) {
      resetSplitToolDrag();
      return;
    }

    if (splitToolDrag.targetArea === "top-stack" && splitToolDrag.targetColumnId) {
      if (splitToolDrag.islandId) {
        splitView.moveToolIslandToTopColumn(splitToolDrag.islandId, splitToolDrag.targetColumnId, splitToolDrag.targetIndex);
      } else {
        splitView.openToolIslandInTopColumn(
          splitToolDrag.sourceSessionId,
          splitToolDrag.toolId,
          splitToolDrag.targetColumnId,
          splitToolDrag.targetIndex,
        );
      }
    } else {
      const targetDock = splitToolDrag.targetArea;
      if (targetDock === "top" || targetDock === "bottom") {
        if (splitToolDrag.islandId) {
          splitView.moveToolIsland(splitToolDrag.islandId, targetDock, splitToolDrag.targetIndex);
        } else {
          splitView.openToolIsland(splitToolDrag.sourceSessionId, splitToolDrag.toolId, targetDock, splitToolDrag.targetIndex);
        }
      }
    }
    resetSplitToolDrag();
  }, [resetSplitToolDrag, splitToolDrag, splitView]);
  const mainToolLabel = mainToolDrag ? PANEL_TOOLS_MAP[mainToolDrag.toolId]?.label ?? mainToolDrag.toolId : null;
  const commitMainToolDrop = useCallback(() => {
    if (!mainToolDrag || mainToolDrag.targetArea === null || mainToolDrag.targetIndex === null) {
      resetMainToolDrag();
      return;
    }

    if (mainToolDrag.targetArea === "top-stack" && mainToolDrag.targetColumnId) {
      if (mainToolDrag.islandId) {
        mainToolWorkspace.moveToolIslandToTopColumn(mainToolDrag.islandId, mainToolDrag.targetColumnId, mainToolDrag.targetIndex);
      } else if (mainToolDrag.toolId in PANEL_TOOLS_MAP) {
        mainToolWorkspace.openToolIslandInTopColumn(mainToolDrag.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">, mainToolDrag.targetColumnId, mainToolDrag.targetIndex);
      }
    } else {
      const targetDock = mainToolDrag.targetArea;
      if ((targetDock === "top" || targetDock === "bottom") && mainToolDrag.toolId in PANEL_TOOLS_MAP) {
        if (mainToolDrag.islandId) {
          mainToolWorkspace.moveToolIsland(mainToolDrag.islandId, targetDock, mainToolDrag.targetIndex);
        } else {
          mainToolWorkspace.openToolIsland(mainToolDrag.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">, targetDock, mainToolDrag.targetIndex);
        }
      }
    }
    resetMainToolDrag();
  }, [mainToolDrag, mainToolWorkspace, resetMainToolDrag]);
  const splitDraggedIsland = useMemo(() => {
    if (!splitToolDrag) return null;

    if (splitToolDrag.islandId) {
      for (const item of splitTopRowItems) {
        if (item.kind !== "tool-column") continue;
        const island = item.islands.find((entry) => entry.id === splitToolDrag.islandId);
        if (island) return island;
      }
      return splitBottomToolIslands.find((island) => island.id === splitToolDrag.islandId) ?? null;
    }

    return splitView.getToolIslandForPane(splitToolDrag.sourceSessionId, splitToolDrag.toolId);
  }, [splitBottomToolIslands, splitToolDrag, splitTopRowItems, splitView]);
  const mainDraggedIsland = useMemo(() => {
    if (!mainToolDrag) return null;
    if (mainToolDrag.islandId) {
      for (const item of mainToolWorkspace.topRowItems) {
        const island = item.islands.find((entry) => entry.id === mainToolDrag.islandId);
        if (island) return island;
      }
      return mainToolWorkspace.bottomToolIslands.find((island) => island.id === mainToolDrag.islandId) ?? null;
    }
    if (!(mainToolDrag.toolId in PANEL_TOOLS_MAP)) return null;
    return mainToolWorkspace.getToolIsland(mainToolDrag.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">);
  }, [mainToolDrag, mainToolWorkspace]);
  const topRowRenderEntries = useMemo<Array<
    | { kind: "item"; item: (typeof splitTopRowItems)[number] }
    | { kind: "preview" }
  >>(() => {
    type TopRowRenderEntry =
      | { kind: "item"; item: (typeof splitTopRowItems)[number] }
      | { kind: "preview" };

    if (!splitToolDrag || splitToolDrag.targetArea === null) {
      return splitTopRowItems.map<TopRowRenderEntry>((item) => ({ kind: "item", item }));
    }

    const draggedIslandId = splitDraggedIsland?.id ?? null;
    const baseItems: TopRowRenderEntry[] = draggedIslandId
      ? splitTopRowItems.reduce<TopRowRenderEntry[]>((entries, item) => {
        if (item.kind !== "tool-column") {
          entries.push({ kind: "item", item });
          return entries;
        }

        const filteredIslands = item.islands.filter((island) => island.id !== draggedIslandId);
        if (filteredIslands.length === item.islands.length) {
          entries.push({ kind: "item", item });
          return entries;
        }
        if (filteredIslands.length === 0) {
          return entries;
        }

        entries.push({
          kind: "item",
          item: {
            ...item,
            column: {
              ...item.column,
              islandIds: filteredIslands.map((island) => island.id),
              splitRatios: equalWidthFractions(filteredIslands.length),
            },
            islands: filteredIslands,
          },
        });
        return entries;
      }, [])
      : splitTopRowItems.map<TopRowRenderEntry>((item) => ({ kind: "item", item }));

    if (splitToolDrag.targetArea !== "top" || splitToolDrag.targetIndex === null) {
      return baseItems;
    }

    const next: TopRowRenderEntry[] = [...baseItems];
    const insertIndex = Math.max(0, Math.min(splitToolDrag.targetIndex, next.length));
    next.splice(insertIndex, 0, { kind: "preview" });
    return next;
  }, [splitDraggedIsland, splitToolDrag, splitTopRowItems]);
  const bottomRowRenderEntries = useMemo<Array<
    | { kind: "item"; island: (typeof splitBottomToolIslands)[number] }
    | { kind: "preview" }
  >>(() => {
    if (!splitToolDrag || splitToolDrag.targetArea === null) {
      return splitBottomToolIslands.map((island) => ({ kind: "item", island }));
    }

    const draggedIslandId = splitDraggedIsland?.id ?? null;
    const baseIslands = draggedIslandId
      ? splitBottomToolIslands.filter((island) => island.id !== draggedIslandId)
      : splitBottomToolIslands;

    if (splitToolDrag.targetArea !== "bottom" || splitToolDrag.targetIndex === null) {
      return baseIslands.map((island) => ({ kind: "item", island }));
    }

    const next: Array<
      | { kind: "item"; island: (typeof splitBottomToolIslands)[number] }
      | { kind: "preview" }
    > = baseIslands.map((island) => ({ kind: "item", island }));
    const insertIndex = Math.max(0, Math.min(splitToolDrag.targetIndex, next.length));
    next.splice(insertIndex, 0, { kind: "preview" });
    return next;
  }, [splitBottomToolIslands, splitDraggedIsland, splitToolDrag]);
  const toolPreviewAffectsTopRowLayout = !!splitToolDrag && splitToolDrag.targetArea !== null;
  const previewTopRowCount = toolPreviewAffectsTopRowLayout
    ? Math.max(topRowRenderEntries.length, 1)
    : (previewDropPosition === null ? splitView.paneCount : splitView.paneCount + 1);
  const previewTopRowFractions = useMemo(
    () => toolPreviewAffectsTopRowLayout
      ? equalWidthFractions(previewTopRowCount)
      : (previewDropPosition === null ? splitView.widthFractions : equalWidthFractions(previewTopRowCount)),
    [previewDropPosition, previewTopRowCount, splitView.widthFractions, toolPreviewAffectsTopRowLayout],
  );
  const bottomRowPreviewAffectsLayout = !!splitToolDrag && (
    splitToolDrag.targetArea === "bottom"
    || splitDraggedIsland?.dock === "bottom"
  );
  const previewBottomRowFractions = useMemo(() => {
    if (bottomRowPreviewAffectsLayout) {
      return equalWidthFractions(Math.max(bottomRowRenderEntries.length, 1));
    }
    return splitView.bottomWidthFractions.length === splitBottomToolIslands.length
      ? splitView.bottomWidthFractions
      : equalWidthFractions(splitBottomToolIslands.length);
  }, [bottomRowPreviewAffectsLayout, bottomRowRenderEntries.length, splitBottomToolIslands.length, splitView.bottomWidthFractions]);
  const splitBottomRowRef = useRef<HTMLDivElement>(null);
  const splitBottomPaneResize = usePaneResize({
    widthFractions: splitView.bottomWidthFractions,
    setWidthFractions: splitView.setBottomWidthFractions,
    containerRef: splitBottomRowRef,
  });
  const splitBottomHeightResize = useBottomHeightResize(splitView.bottomHeight, splitView.setBottomHeight);
  const mainBottomHeightResize = useBottomHeightResize(mainToolWorkspace.bottomHeight, mainToolWorkspace.setBottomHeight);
  const isSplitBottomHeightResizing = splitBottomHeightResize.isResizing;
  const isMainBottomHeightResizing = mainBottomHeightResize.isResizing;
  const splitToolColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const splitToolColumnResize = useToolColumnResize({
    columnRefs: splitToolColumnRefs,
    setSplitRatios: splitView.setTopToolColumnSplitRatios,
  });
  const mainToolColumnResize = useToolColumnResize({
    columnRefs: mainTopToolColumnRefs,
    setSplitRatios: mainToolWorkspace.setTopToolColumnSplitRatios,
  });

  // ── Chat scroll fade & titlebar tinting ──

  const chatIslandRef = useRef<HTMLDivElement>(null);
  const lastTopScrollProgressRef = useRef(0);

  // Per-pane scroll progress refs for split view (up to 4 panes)
  const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastPaneScrollProgressRefs = useRef<number[]>([]);


  useEffect(() => {
    // Grabbed elements are session-specific context — discard on switch
    setGrabbedElements([]);
  }, [manager.activeSessionId]);

  useLayoutEffect(() => {
    lastTopScrollProgressRef.current = 0;
    chatIslandRef.current?.style.setProperty("--chat-top-progress", "0");
  }, [manager.activeSessionId]);

  const handleTopScrollProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(lastTopScrollProgressRef.current - clamped) < 0.005) return;
    lastTopScrollProgressRef.current = clamped;
    chatIslandRef.current?.style.setProperty("--chat-top-progress", clamped.toFixed(3));
  }, []);

  /** Create a scroll progress callback for a specific pane index. */
  const makePaneScrollCallback = useCallback((paneIndex: number) => {
    return (progress: number) => {
      const clamped = Math.max(0, Math.min(1, progress));
      const prev = lastPaneScrollProgressRefs.current[paneIndex] ?? 0;
      if (Math.abs(prev - clamped) < 0.005) return;
      lastPaneScrollProgressRefs.current[paneIndex] = clamped;
      paneRefs.current[paneIndex]?.style.setProperty("--chat-top-progress", clamped.toFixed(3));
    };
  }, []);

  const handleScrolledToMessage = useCallback(() => {
    setScrollToMessageId(undefined);
  }, []);

  const handleRevert = useCallback((checkpointId: string) => {
    if (manager.isConnected && manager.revertFiles) {
      manager.revertFiles(checkpointId);
    }
  }, [manager.isConnected, manager.revertFiles]);

  const handleFullRevert = useCallback((checkpointId: string) => {
    if (manager.isConnected && manager.fullRevert) {
      manager.fullRevert(checkpointId);
    }
  }, [manager.isConnected, manager.fullRevert]);

  const activeSessionProject = manager.activeSession
    ? projectManager.projects.find((project) => project.id === manager.activeSession?.projectId) ?? null
    : null;
  const activeSessionSpaceId = activeSessionProject?.spaceId || "default";
  const isCrossSpaceSessionVisible = !!manager.activeSession && activeSessionSpaceId !== spaceManager.activeSpaceId;
  const { spaceSwitchLayoutCooldown, hasSpaceChangedThisRender } = useSpaceSwitchCooldown({
    activeSpaceId: spaceManager.activeSpaceId,
    isSpaceSwitching,
    isCrossSpaceSessionVisible,
  });

  const getPreviewPaneMetrics = useCallback((previewIndex: number) => {
    const widthPercent = (previewTopRowFractions[previewIndex] ?? (1 / previewTopRowCount)) * 100;
    const totalHandleWidth = (previewTopRowCount - 1) * SPLIT_HANDLE_WIDTH;
    const handleSharePx = totalHandleWidth / previewTopRowCount;
    return { widthPercent, handleSharePx };
  }, [previewTopRowCount, previewTopRowFractions]);
  const shouldAnimateTopRowLayout = !paneResize.isResizing
    && !isResizing
    && !mainToolPaneResize.isResizing
    && !isMainToolAreaResizing
    && !mainBottomPaneResize.isResizing
    && !isMainBottomHeightResizing
    && !isSpaceSwitching
    && !isCrossSpaceSessionVisible
    && !hasSpaceChangedThisRender
    && !spaceSwitchLayoutCooldown;
  const showSinglePaneSplitPreview = !isSplitActive && splitDragDrop.dragState.isDragging && !!manager.activeSessionId;
  const singlePanePreviewPosition = splitDragDrop.dragState.dropPosition === 0 ? 0 : 1;
  const singlePanePreviewPaneStyle = useMemo(() => {
    const { widthPercent, handleSharePx } = getPreviewPaneMetrics(singlePanePreviewPosition);
    return {
      width: `calc(${widthPercent}% - ${handleSharePx}px)`,
      minWidth: MIN_CHAT_WIDTH_SPLIT,
    } as React.CSSProperties;
  }, [getPreviewPaneMetrics, singlePanePreviewPosition]);

  // ── Pane controller context (shared between active pane and split panes) ──
  const paneControllerCtx = useMemo<PaneControllerContext>(() => ({
    agents,
    selectedAgent,
    settings: {
      getModelForEngine: settings.getModelForEngine,
      permissionMode: settings.permissionMode,
      planMode: settings.planMode,
      claudeEffort: settings.claudeEffort,
      acpPermissionBehavior: settings.acpPermissionBehavior,
    },
    handleModelChange,
    handleClaudeModelEffortChange,
    handlePlanModeChange,
    handlePermissionModeChange,
    handleAgentChange,
    handleStop,
    handleComposerClear,
    wrappedHandleSend,
    manager: {
      setSessionModel: manager.setSessionModel,
      setSessionClaudeModelAndEffort: manager.setSessionClaudeModelAndEffort,
      setSessionPlanMode: manager.setSessionPlanMode,
      setSessionPermissionMode: manager.setSessionPermissionMode,
      setCodexEffort: manager.setCodexEffort,
      codexEffort: manager.codexEffort,
      codexRawModels: manager.codexRawModels,
      codexModelsLoadingMessage: manager.codexModelsLoadingMessage,
      cachedClaudeModels: manager.cachedClaudeModels,
      acpConfigOptions: manager.acpConfigOptions,
      acpConfigOptionsLoading: manager.acpConfigOptionsLoading,
      setACPConfig: manager.setACPConfig,
    },
    splitView: {
      setFocusedSession: splitView.setFocusedSession,
    },
    createSplitPaneDraftSession,
    queueSplitPaneSendAfterSwitch,
  }), [
    agents, selectedAgent, settings, manager, splitView.setFocusedSession,
    handleModelChange, handleClaudeModelEffortChange, handlePlanModeChange,
    handlePermissionModeChange, handleAgentChange, handleStop,
    handleComposerClear, wrappedHandleSend,
    createSplitPaneDraftSession, queueSplitPaneSendAfterSwitch,
  ]);

  const renderSplitTopRowItem = useCallback((
    item: (typeof splitTopRowItems)[number],
    displayIndex: number,
    previewIndex: number,
    insertBeforeIndex: number,
  ) => {
    const { widthPercent, handleSharePx } = getPreviewPaneMetrics(previewIndex);

    if (item.kind === "tool-column") {
      const renderedIslands = splitToolDrag && splitToolDrag.islandId && splitToolDrag.targetArea !== null
        ? item.islands.filter((island) => island.id !== splitToolDrag.islandId)
        : item.islands;
      const stackEntries: Array<{ kind: "item"; island: (typeof item.islands)[number] } | { kind: "preview" }> = (
        splitToolDrag?.targetArea === "top-stack" && splitToolDrag.targetColumnId === item.column.id
      )
        ? (() => {
          const next: Array<{ kind: "item"; island: (typeof item.islands)[number] } | { kind: "preview" }> = renderedIslands.map((island) => ({ kind: "item", island }));
          const insertIndex = Math.max(0, Math.min(splitToolDrag.targetIndex ?? next.length, next.length));
          next.splice(insertIndex, 0, { kind: "preview" });
          return next;
        })()
        : renderedIslands.map((island) => ({ kind: "item", island }));
      const stackRatios = stackEntries.some((entry) => entry.kind === "preview")
        ? equalWidthFractions(Math.max(stackEntries.length, 1))
        : normalizeRatios(item.column.splitRatios, Math.max(stackEntries.length, 1));

      const renderToolIsland = (
        island: (typeof item.islands)[number],
        fraction: number,
        stackInsertBeforeIndex: number,
        session: typeof manager.activeSession,
        paneState: typeof manager.primaryPane,
        isActiveSessionPane: boolean,
      ) => {
        const paneProject = session
          ? projectManager.projects.find((project) => project.id === session.projectId) ?? null
          : null;
        const paneProjectPath = paneProject
          ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
          : activeProjectPath;
        const paneProjectRoot = paneProject?.path;
        const controls = (
          <PanelDockControls
            isBottom={false}
            moveLabel="Move to bottom"
            onMovePlacement={() => splitView.moveToolIsland(island.id, "bottom")}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", island.id);
              event.dataTransfer.effectAllowed = "move";
              setSplitToolDrag({
                toolId: island.toolId,
                sourceSessionId: island.sourceSessionId,
                islandId: island.id,
                targetArea: null,
                targetIndex: null,
                targetColumnId: null,
              });
            }}
            onDragEnd={resetSplitToolDrag}
          />
        );
        return (
          <div
            className="island flex min-h-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
            style={{ flex: `${fraction} 1 0%`, minHeight: 0 }}
            onDragOver={(event) => {
              if (!splitToolDrag || splitToolDrag.islandId === island.id) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const intent = getToolColumnDropIntent(rect, event.clientX, event.clientY);
              setSplitToolDrag((current) => current ? {
                ...current,
                targetArea: intent.area,
                targetIndex: intent.area === "top"
                  ? (intent.side === "before" ? insertBeforeIndex : insertBeforeIndex + 1)
                  : (intent.side === "before" ? stackInsertBeforeIndex : stackInsertBeforeIndex + 1),
                targetColumnId: intent.area === "top-stack" ? item.column.id : null,
              } : current);
            }}
            onDrop={(event) => {
              if (!splitToolDrag) return;
              event.preventDefault();
              event.stopPropagation();
              commitSplitToolDrop();
            }}
          >
            <ToolIslandContent
              toolId={island.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">}
              persistKey={island.persistKey}
              headerControls={controls}
              projectPath={paneProjectPath}
              projectRoot={paneProjectRoot}
              projectId={paneProject?.id ?? null}
              sessionId={island.sourceSessionId}
              messages={paneState.messages}
              activeEngine={session?.engine}
              isActiveSessionPane={isActiveSessionPane}
              hasLiveSession={paneState.isConnected}
              spaceId={spaceManager.activeSpaceId}
              terminalTabs={activeSpaceTerminals.tabs}
              activeTerminalTabId={activeSpaceTerminals.activeTabId}
              terminalsReady={spaceTerminals.isReady}
              onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
              onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
              onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
              onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
              resolvedTheme={resolvedTheme}
              onElementGrab={isActiveSessionPane ? handleElementGrab : undefined}
              onScrollToToolCall={setScrollToMessageId}
              onPreviewFile={handlePreviewFile}
              collapsedRepos={settings.collapsedRepos}
              onToggleRepoCollapsed={settings.toggleRepoCollapsed}
              selectedWorktreePath={paneProjectPath}
              onSelectWorktreePath={isActiveSessionPane ? handleAgentWorktreeChange : undefined}
              mcpServerStatuses={manager.mcpServerStatuses}
              mcpStatusPreliminary={manager.mcpStatusPreliminary}
              onRefreshMcpStatus={manager.refreshMcpStatus}
              onReconnectMcpServer={manager.reconnectMcpServer}
              onRestartWithMcpServers={manager.restartWithMcpServers}
            />
          </div>
        );
      };

      const renderColumn = (session: typeof manager.activeSession, paneState: typeof manager.primaryPane, isActiveSessionPane: boolean) => (
        <motion.div
          layout={shouldAnimateTopRowLayout}
          transition={shouldAnimateTopRowLayout
            ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
            : { duration: 0 }}
          ref={(element) => { splitToolColumnRefs.current[item.column.id] = element; }}
          className="flex min-h-0 min-w-0 flex-col"
          style={{
            width: `calc(${widthPercent}% - ${handleSharePx}px)`,
            minWidth: MIN_CHAT_WIDTH_SPLIT,
            flexShrink: 0,
          } as React.CSSProperties}
        >
          {stackEntries.map((entry, stackIndex) => {
            const fraction = stackRatios[stackIndex] ?? (1 / Math.max(stackEntries.length, 1));
            const stackInsertBeforeIndex = stackEntries
              .slice(0, stackIndex)
              .filter((candidate) => candidate.kind === "item")
              .length;
            const previousEntry = stackIndex > 0 ? stackEntries[stackIndex - 1] : null;
            const stackHandleIndex = stackInsertBeforeIndex - 1;
            const canResizeStackPair = previousEntry?.kind === "item" && entry.kind === "item" && stackHandleIndex >= 0;
            const isStackPairResizing = splitToolColumnResize.activeResizeId === `${item.column.id}:${stackHandleIndex}`;

            return (
              <React.Fragment key={entry.kind === "item" ? entry.island.id : `top-stack-preview-${item.column.id}-${stackIndex}`}>
                {stackIndex > 0 && (
                  canResizeStackPair ? (
                    <div
                      className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                      style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                      onMouseDown={(event) => splitToolColumnResize.handleResizeStart(
                        item.column.id,
                        stackHandleIndex,
                        item.column.splitRatios,
                        event,
                      )}
                      onDoubleClick={() => splitView.setTopToolColumnSplitRatios(
                        item.column.id,
                        equalWidthFractions(item.islands.length),
                      )}
                    >
                      <div
                        className={`h-0.5 w-10 rounded-full transition-colors duration-150 ${
                          isStackPairResizing
                            ? "bg-foreground/40"
                            : "bg-transparent group-hover:bg-foreground/25"
                        }`}
                      />
                    </div>
                  ) : (
                    <div
                      className="h-2 shrink-0"
                      style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                    />
                  )
                )}
                {entry.kind === "preview" ? (
                  <div
                    className="flex min-h-0"
                    style={{ flex: `${fraction} 1 0%`, minHeight: 0 }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      const intent = getToolColumnDropIntent(rect, event.clientX, event.clientY);
                      setSplitToolDrag((current) => current ? {
                        ...current,
                        targetArea: intent.area,
                        targetIndex: intent.area === "top"
                          ? (intent.side === "before" ? insertBeforeIndex : insertBeforeIndex + 1)
                          : (intent.side === "before" ? stackInsertBeforeIndex : stackInsertBeforeIndex + 1),
                        targetColumnId: intent.area === "top-stack" ? item.column.id : null,
                      } : current);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      commitSplitToolDrop();
                    }}
                  >
                    <PanelDockPreview orientation="vertical" label={splitToolLabel ?? undefined} className="min-h-0 flex-1" />
                  </div>
                ) : (
                  renderToolIsland(entry.island, fraction, stackInsertBeforeIndex, session, paneState, isActiveSessionPane)
                )}
              </React.Fragment>
            );
          })}
        </motion.div>
      );

      const primaryIsland = item.islands[0] ?? null;
      if (!primaryIsland) return null;
      if (primaryIsland.sourceSessionId === manager.activeSessionId) {
        return renderColumn(manager.activeSession, manager.primaryPane, true);
      }

      return (
        <SplitPaneHost
          key={item.column.id}
          sessionId={primaryIsland.sourceSessionId}
          acpPermissionBehavior={settings.acpPermissionBehavior}
          loadBootstrap={manager.loadSplitPaneBootstrap}
        >
          {({ session, paneState }) => renderColumn(session, paneState, false)}
        </SplitPaneHost>
      );
    }

    const sessionId = item.sessionId;
    const session = sessionId === manager.activeSessionId
      ? manager.activeSession
      : null;
    const paneState = sessionId === manager.activeSessionId
      ? manager.primaryPane
      : null;

    const buildChatPaneProps = (resolvedSession: typeof manager.activeSession, resolvedPaneState: typeof manager.primaryPane, isActiveSessionPane: boolean) => {
      const paneProject = resolvedSession
        ? projectManager.projects.find((project) => project.id === resolvedSession.projectId) ?? null
        : null;
      const paneProjectPath = paneProject
        ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
        : activeProjectPath;
      const activeContextualTool = splitView.getPaneContextualTool(sessionId);

      return {
        sessionId,
        displayIndex,
        session: resolvedSession,
        paneState: resolvedPaneState,
        paneControllerCtx,
        isActiveSessionPane,
        widthPercent,
        handleSharePx,
        isIsland,
        shouldAnimate: shouldAnimateTopRowLayout,
        chatFadeStrength,
        topFadeBackground,
        titlebarSurfaceColor,
        bottomFadeBackground,
        isFocused: splitView.focusedSessionId === sessionId,
        sidebarOpen: sidebar.isOpen,
        onToggleSidebar: sidebar.toggle,
        showThinking,
        autoGroupTools: settings.autoGroupTools,
        avoidGroupingEdits: settings.avoidGroupingEdits,
        autoExpandTools: settings.autoExpandTools,
        expandEditToolCallsByDefault: settings.expandEditToolCallsByDefault,
        showToolIcons: settings.showToolIcons,
        coloredToolIcons: settings.coloredToolIcons,
        acpPermissionBehavior: settings.acpPermissionBehavior,
        onAcpPermissionBehaviorChange: settings.setAcpPermissionBehavior,
        agents,
        showDevFill: isActiveSessionPane ? devFillEnabled : false,
        onSeedDevExampleConversation: isActiveSessionPane ? manager.seedDevExampleConversation : undefined,
        onSeedDevExampleSpaceData: isActiveSessionPane ? handleSeedDevExampleSpaceData : undefined,
        grabbedElements: isActiveSessionPane ? grabbedElements : [],
        onRemoveGrabbedElement: handleRemoveGrabbedElement,
        lockedEngine: isActiveSessionPane ? lockedEngine : (resolvedSession?.engine ?? null),
        lockedAgentId: isActiveSessionPane ? lockedAgentId : (resolvedSession?.agentId ?? null),
        projectPath: paneProjectPath,
        selectedWorktreePath: paneProjectPath,
        onSelectWorktree: isActiveSessionPane ? handleAgentWorktreeChange : undefined,
        codexModelData: manager.codexRawModels,
        spaceId: spaceManager.activeSpaceId,
        onRevert: isActiveSessionPane && manager.isConnected && manager.revertFiles ? handleRevert : undefined,
        onFullRevert: isActiveSessionPane && manager.isConnected && manager.fullRevert ? handleFullRevert : undefined,
        onTopScrollProgress: makePaneScrollCallback(displayIndex),
        onClosePane: () => { void handleCloseSplitPane(sessionId); },
        onFocus: () => splitView.setFocusedSession(sessionId),
        queuedCount: isActiveSessionPane ? manager.queuedCount : 0,
        splitView,
        availableContextual,
        activeContextualTool,
        activeTodos,
        bgAgents,
        onToolDragStart: (event: React.DragEvent<HTMLButtonElement>, toolId: ToolId) => {
          event.dataTransfer.setData("text/plain", toolId);
          event.dataTransfer.effectAllowed = "move";
          setSplitToolDrag({
            toolId,
            sourceSessionId: sessionId,
            islandId: null,
            targetArea: null,
            targetIndex: null,
            targetColumnId: null,
          });
        },
        onToolDragEnd: resetSplitToolDrag,
        onChatPaneDragOver: splitToolDrag ? (event: React.DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const insertSide = getHorizontalInsertSide(rect, event.clientX);
          if (!insertSide) return;
          setSplitToolDrag((current) => current ? {
            ...current,
            targetArea: "top",
            targetIndex: insertSide === "before" ? insertBeforeIndex : insertBeforeIndex + 1,
          } : current);
        } : undefined,
        onChatPaneDrop: splitToolDrag ? (event: React.DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          commitSplitToolDrop();
        } : undefined,
        paneRef: (element: HTMLDivElement | null) => { paneRefs.current[displayIndex] = element; },
      } as const;
    };

    if (session && paneState) {
      return <SplitChatPane {...buildChatPaneProps(session, paneState, true)} />;
    }

    return (
      <SplitPaneHost
        key={sessionId}
        sessionId={sessionId}
        acpPermissionBehavior={settings.acpPermissionBehavior}
        loadBootstrap={manager.loadSplitPaneBootstrap}
      >
        {({ session: hostedSession, paneState: hostedPaneState }) => (
          <SplitChatPane {...buildChatPaneProps(hostedSession, hostedPaneState, false)} />
        )}
      </SplitPaneHost>
    );
  }, [activeProjectPath, activeTodos, availableContextual, bgAgents, bottomFadeBackground, chatFadeStrength, commitSplitToolDrop, devFillEnabled, getPreviewPaneMetrics, grabbedElements, handleAgentWorktreeChange, handleCloseSplitPane, handleFullRevert, handleRemoveGrabbedElement, handleRevert, handleSeedDevExampleSpaceData, isIsland, lockedAgentId, lockedEngine, makePaneScrollCallback, manager, paneControllerCtx, projectManager.projects, resetSplitToolDrag, settings.acpPermissionBehavior, settings.autoExpandTools, settings.autoGroupTools, settings.avoidGroupingEdits, settings.coloredToolIcons, settings.expandEditToolCallsByDefault, settings.setAcpPermissionBehavior, settings.showToolIcons, shouldAnimateTopRowLayout, showThinking, sidebar.isOpen, sidebar.toggle, spaceManager.activeSpaceId, splitBottomToolIslands.length, splitToolColumnResize.activeResizeId, splitToolColumnResize.handleResizeStart, splitToolDrag, splitTopRowItems.length, splitView, titlebarSurfaceColor, topFadeBackground, agents]);

  const renderSplitBottomToolIsland = useCallback((
    island: (typeof splitBottomToolIslands)[number],
    fraction: number,
    insertBeforeIndex: number,
  ) => {
    const renderToolIsland = (session: typeof manager.activeSession, paneState: typeof manager.primaryPane, isActiveSessionPane: boolean) => {
      const paneProject = session
        ? projectManager.projects.find((project) => project.id === session.projectId) ?? null
        : null;
      const paneProjectPath = paneProject
        ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
        : activeProjectPath;
      const paneProjectRoot = paneProject?.path;
      const controls = (
        <PanelDockControls
          isBottom={true}
          moveLabel="Move to top row"
          moveIcon={ArrowUp}
          onMovePlacement={() => splitView.moveToolIsland(island.id, "top")}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", island.id);
            event.dataTransfer.effectAllowed = "move";
            setSplitToolDrag({
              toolId: island.toolId,
              sourceSessionId: island.sourceSessionId,
              islandId: island.id,
              targetArea: null,
              targetIndex: null,
              targetColumnId: null,
            });
          }}
          onDragEnd={resetSplitToolDrag}
        />
      );

      return (
        <motion.div
          layout={shouldAnimateTopRowLayout}
          transition={shouldAnimateTopRowLayout
            ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
            : { duration: 0 }}
          className="island flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
          style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
          onDragOver={(event) => {
            if (!splitToolDrag || splitToolDrag.islandId === island.id) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const insertSide = getHorizontalInsertSide(rect, event.clientX);
            if (!insertSide) return;
            setSplitToolDrag((current) => current ? {
              ...current,
              targetArea: "bottom",
              targetIndex: insertSide === "before" ? insertBeforeIndex : insertBeforeIndex + 1,
            } : current);
          }}
          onDrop={(event) => {
            if (!splitToolDrag) return;
            event.preventDefault();
            commitSplitToolDrop();
          }}
        >
          <ToolIslandContent
            toolId={island.toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">}
            persistKey={island.persistKey}
            headerControls={controls}
            projectPath={paneProjectPath}
            projectRoot={paneProjectRoot}
            projectId={paneProject?.id ?? null}
            sessionId={island.sourceSessionId}
            messages={paneState.messages}
            activeEngine={session?.engine}
            isActiveSessionPane={isActiveSessionPane}
            hasLiveSession={paneState.isConnected}
            spaceId={spaceManager.activeSpaceId}
            terminalTabs={activeSpaceTerminals.tabs}
            activeTerminalTabId={activeSpaceTerminals.activeTabId}
            terminalsReady={spaceTerminals.isReady}
            onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
            onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
            onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
            onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
            resolvedTheme={resolvedTheme}
            onElementGrab={isActiveSessionPane ? handleElementGrab : undefined}
            onScrollToToolCall={setScrollToMessageId}
            onPreviewFile={handlePreviewFile}
            collapsedRepos={settings.collapsedRepos}
            onToggleRepoCollapsed={settings.toggleRepoCollapsed}
            selectedWorktreePath={paneProjectPath}
            onSelectWorktreePath={isActiveSessionPane ? handleAgentWorktreeChange : undefined}
            mcpServerStatuses={manager.mcpServerStatuses}
            mcpStatusPreliminary={manager.mcpStatusPreliminary}
            onRefreshMcpStatus={manager.refreshMcpStatus}
            onReconnectMcpServer={manager.reconnectMcpServer}
            onRestartWithMcpServers={manager.restartWithMcpServers}
          />
        </motion.div>
      );
    };

    if (island.sourceSessionId === manager.activeSessionId) {
      return renderToolIsland(manager.activeSession, manager.primaryPane, true);
    }

    return (
      <SplitPaneHost
        key={island.id}
        sessionId={island.sourceSessionId}
        acpPermissionBehavior={settings.acpPermissionBehavior}
        loadBootstrap={manager.loadSplitPaneBootstrap}
      >
        {({ session, paneState }) => renderToolIsland(session, paneState, false)}
      </SplitPaneHost>
    );
  }, [activeProjectPath, activeSpaceTerminalCwd, activeSpaceTerminals.activeTabId, activeSpaceTerminals.tabs, commitSplitToolDrop, handleAgentWorktreeChange, handleElementGrab, handlePreviewFile, manager, projectManager.projects, resetSplitToolDrag, resolvedTheme, setScrollToMessageId, settings.acpPermissionBehavior, settings.collapsedRepos, settings.toggleRepoCollapsed, shouldAnimateTopRowLayout, spaceManager.activeSpaceId, spaceTerminals, splitToolDrag, splitTopRowItems.length, splitView]);

  const activePaneController = usePaneController(
    manager.activeSessionId ?? "",
    manager.activeSession,
    manager.primaryPane,
    true,
    paneControllerCtx,
  );
  // Only expose the controller when there's an active session
  const activePaneCtrl = manager.activeSessionId ? activePaneController : null;

  const { activeTools } = settings;
  useEffect(() => {
    if (!manager.activeSessionId) return;
    const hasLegacyPanelTools = [...settings.activeTools].some((toolId) => toolId in PANEL_TOOLS_MAP);
    if (!hasLegacyPanelTools) return;
    settings.setActiveTools((prev) => {
      const next = new Set([...prev].filter((toolId) => !(toolId in PANEL_TOOLS_MAP)));
      return next.size === prev.size ? prev : next;
    });
  }, [manager.activeSessionId, settings]);
  const mainOpenPanelToolIds = useMemo(
    () => new Set<ToolId>([
      ...mainToolWorkspace.topRowItems.flatMap((item) => item.islands.map((island) => island.toolId)),
      ...mainToolWorkspace.bottomToolIslands.map((island) => island.toolId),
    ]),
    [mainToolWorkspace.bottomToolIslands, mainToolWorkspace.topRowItems],
  );
  const mainPickerActiveTools = useMemo(
    () => new Set<ToolId>([
      ...activeTools,
      ...mainOpenPanelToolIds,
    ]),
    [activeTools, mainOpenPanelToolIds],
  );
  const mainTopToolColumnCount = mainToolWorkspace.topRowItems.length;
  // Use the reduced split min-width whenever there's an active session, since tool islands
  // can be added at any time. This avoids a 304px layout jump when the first tool column
  // is opened or the last one is closed.
  const mainWorkspaceChatMinWidth = manager.activeSessionId
    ? MIN_CHAT_WIDTH_SPLIT
    : minChatWidth;
  const mainHasToolWorkspace = mainTopToolColumnCount > 0 || mainToolWorkspace.bottomToolIslands.length > 0 || !!mainToolDrag;
  const mainWorkspaceReservedWidth = (showToolPicker ? pickerW : 0)
    + (hasRightPanel ? settings.rightPanelWidth + handleW : 0)
    + (mainHasToolWorkspace ? handleW : 0);
  const mainCombinedWorkspaceWidth = Math.max(0, availableSplitWidth - mainWorkspaceReservedWidth);
  mainCombinedWorkspaceWidthRef.current = mainCombinedWorkspaceWidth;
  const mainMaxToolAreaWidth = Math.max(0, mainCombinedWorkspaceWidth - mainWorkspaceChatMinWidth);
  const mainShowTopToolArea = mainTopToolColumnCount > 0 || mainToolDrag?.targetArea === "top" || mainToolDrag?.targetArea === "top-stack";
  const mainTopPreviewColumnCount = mainTopToolColumnCount + (
    mainToolDrag?.targetArea === "top" && mainDraggedIsland?.dock !== "top" ? 1 : 0
  );
  const mainRequiredToolWidth = mainShowTopToolArea
    ? getRequiredToolIslandsWidth(Math.max(mainTopPreviewColumnCount, 1))
    : 0;
  const mainMinChatFraction = mainCombinedWorkspaceWidth > 0
    ? Math.min(0.92, mainWorkspaceChatMinWidth / mainCombinedWorkspaceWidth)
    : 1;
  const mainMinToolFraction = mainShowTopToolArea && mainCombinedWorkspaceWidth > 0
    ? Math.min(0.92, mainRequiredToolWidth / mainCombinedWorkspaceWidth)
    : 0;
  const storedMainChatFraction = mainToolWorkspace.widthFractions[0] ?? 1;
  const mainMaxChatFraction = Math.max(0, 1 - mainMinToolFraction);
  const effectiveMainChatFraction = mainShowTopToolArea
    ? Math.min(mainMaxChatFraction, Math.max(mainMinChatFraction, storedMainChatFraction))
    : 1;
  const effectiveMainToolAreaFraction = mainShowTopToolArea
    ? Math.max(0, 1 - effectiveMainChatFraction)
    : 0;
  const mainToolAreaWidth = Math.max(0, mainCombinedWorkspaceWidth * effectiveMainToolAreaFraction);
  const mainToolRelativeFractions = mainTopToolColumnCount > 0
    ? normalizeRatios(mainToolWorkspace.widthFractions.slice(1), mainTopToolColumnCount)
    : [];
  const maxMainTopToolColumns = Math.max(
    1,
    Math.floor((mainMaxToolAreaWidth + SPLIT_HANDLE_WIDTH) / (MIN_TOOLS_PANEL_WIDTH + SPLIT_HANDLE_WIDTH)),
  );
  const isAddingMainTopColumn = !mainDraggedIsland || mainDraggedIsland.dock !== "top";
  const canAddMainTopColumn = isAddingMainTopColumn
    ? mainTopToolColumnCount < maxMainTopToolColumns
    : mainTopToolColumnCount <= maxMainTopToolColumns;

  /** Check if a specific tool can fit as a new column at its preferred width. */
  const canFitToolAsNewColumn = useCallback((toolId: ToolId): boolean => {
    const preferredPx = TOOL_PREFERRED_WIDTHS[toolId] ?? DEFAULT_TOOL_PREFERRED_WIDTH;
    const handleCost = mainTopToolColumnCount > 0 ? SPLIT_HANDLE_WIDTH : 0;
    const totalNeeded = mainToolAreaWidth + handleCost + preferredPx;
    return mainCombinedWorkspaceWidth - totalNeeded >= mainWorkspaceChatMinWidth;
  }, [mainToolAreaWidth, mainTopToolColumnCount, mainCombinedWorkspaceWidth, mainWorkspaceChatMinWidth]);

  const handleMainToolAreaResizeStart = useCallback((event: React.MouseEvent) => {
    if (mainTopToolColumnCount <= 0 || mainCombinedWorkspaceWidth <= 0) return;

    event.preventDefault();
    setIsMainToolAreaResizing(true);
    const startX = event.clientX;
    const startFractions = mainToolWorkspace.widthFractions.length === mainTopToolColumnCount + 1
      ? [...mainToolWorkspace.widthFractions]
      : [effectiveMainChatFraction, ...mainToolRelativeFractions.map((fraction) => fraction * effectiveMainToolAreaFraction)];
    const firstToolFraction = startFractions[1] ?? 0;
    const otherToolFractions = startFractions.slice(2);
    const otherToolFractionTotal = otherToolFractions.reduce((sum, fraction) => sum + fraction, 0);
    const minFirstToolFraction = Math.min(0.92, MIN_TOOLS_PANEL_WIDTH / mainCombinedWorkspaceWidth);
    const maxFirstToolFraction = Math.max(
      minFirstToolFraction,
      1 - otherToolFractionTotal - mainMinChatFraction,
    );

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaFraction = (startX - moveEvent.clientX) / mainCombinedWorkspaceWidth;
      const nextFirstToolFraction = Math.max(
        minFirstToolFraction,
        Math.min(maxFirstToolFraction, firstToolFraction + deltaFraction),
      );
      const nextChatFraction = Math.max(0, 1 - otherToolFractionTotal - nextFirstToolFraction);
      // Fractions are already clamped above — bypass double-clamping via setWidthFractionsDirect
      mainToolWorkspace.setWidthFractionsDirect([
        nextChatFraction,
        nextFirstToolFraction,
        ...otherToolFractions,
      ]);
    };

    const handleUp = () => {
      setIsMainToolAreaResizing(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [
    effectiveMainChatFraction,
    effectiveMainToolAreaFraction,
    mainCombinedWorkspaceWidth,
    mainMinChatFraction,
    mainToolRelativeFractions,
    mainToolWorkspace,
    mainTopToolColumnCount,
  ]);
  useEffect(() => {
    if (isSplitActive) return;
    if (mainTopToolColumnCount <= maxMainTopToolColumns) return;
    const targetColumnId = mainToolWorkspace.topRowItems[Math.max(0, maxMainTopToolColumns - 1)]?.column.id ?? null;
    if (!targetColumnId) return;
    const overflowColumns = mainToolWorkspace.topRowItems.slice(maxMainTopToolColumns);
    for (const column of overflowColumns) {
      for (const island of column.islands) {
        mainToolWorkspace.moveToolIslandToTopColumn(island.id, targetColumnId);
      }
    }
  }, [isSplitActive, mainToolWorkspace, mainTopToolColumnCount, maxMainTopToolColumns]);

  // ── Shared tool island context (terminal/MCP/git props common to all islands) ──
  const toolIslandCtx = useToolIslandContext({
    spaceId: spaceManager.activeSpaceId,
    terminalTabs: activeSpaceTerminals.tabs,
    activeTerminalTabId: activeSpaceTerminals.activeTabId,
    terminalsReady: spaceTerminals.isReady,
    onSetActiveTab: (tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId),
    onCreateTerminal: () => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined),
    onEnsureTerminal: () => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined),
    onCloseTerminal: (tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId),
    resolvedTheme,
    onElementGrab: handleElementGrab,
    onScrollToToolCall: setScrollToMessageId,
    onPreviewFile: handlePreviewFile,
    collapsedRepos: settings.collapsedRepos,
    onToggleRepoCollapsed: settings.toggleRepoCollapsed,
    mcpServerStatuses: manager.mcpServerStatuses,
    mcpStatusPreliminary: manager.mcpStatusPreliminary,
    onRefreshMcpStatus: manager.refreshMcpStatus,
    onReconnectMcpServer: manager.reconnectMcpServer,
    onRestartWithMcpServers: manager.restartWithMcpServers,
  });

  const renderMainWorkspaceToolContent = useCallback((
    toolId: Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">,
    controls: React.ReactNode,
  ) => (
    <ToolIslandContent
      toolId={toolId}
      persistKey={`main:${spaceManager.activeSpaceId}`}
      headerControls={controls}
      projectPath={activeProjectPath}
      projectRoot={activeSpaceProject?.path}
      projectId={activeProjectId ?? null}
      sessionId={manager.activeSessionId}
      messages={manager.messages}
      activeEngine={manager.activeSession?.engine}
      isActiveSessionPane={true}
      hasLiveSession={!manager.isDraft}
      selectedWorktreePath={activeSpaceTerminalCwd}
      onSelectWorktreePath={handleAgentWorktreeChange}
      {...toolIslandCtx}
    />
  ), [activeProjectId, activeProjectPath, activeSpaceProject?.path, activeSpaceTerminalCwd, handleAgentWorktreeChange, manager.activeSession?.engine, manager.activeSessionId, manager.isDraft, manager.messages, spaceManager.activeSpaceId, toolIslandCtx]);
  const moveMainBottomToolToTop = useCallback((islandId: string) => {
    const island = mainToolWorkspace.bottomToolIslands.find((i) => i.id === islandId);
    if ((island && canFitToolAsNewColumn(island.toolId)) || mainToolWorkspace.topRowItems.length === 0) {
      mainToolWorkspace.moveToolIsland(islandId, "top");
      return;
    }

    const lastColumnId = mainToolWorkspace.topRowItems[mainToolWorkspace.topRowItems.length - 1]?.column.id;
    if (lastColumnId) {
      mainToolWorkspace.moveToolIslandToTopColumn(islandId, lastColumnId);
      return;
    }

    mainToolWorkspace.moveToolIsland(islandId, "top");
  }, [mainToolWorkspace, canFitToolAsNewColumn]);
  const showCodexAuthDialog =
    !!manager.activeSessionId &&
    manager.activeSession?.engine === "codex" &&
    manager.codexAuthRequired;
  const acpAuthAgentName = manager.acpAuthAgentId
    ? agents.find((agent) => agent.id === manager.acpAuthAgentId)?.name ?? manager.acpAuthAgentId
    : "ACP Agent";
  const showAcpAuthDialog =
    !!manager.acpAuthSessionId &&
    manager.acpAuthRequired;

  return (
    <div
      className={`relative flex h-screen overflow-hidden bg-sidebar text-foreground${settings.islandLayout ? "" : " no-islands"}${settings.islandShine ? "" : " no-island-shine"}`}
      style={islandLayoutVars}
    >
      {/* Glass tint overlay — sits behind content, tints the native transparency */}
      {glassOverlayStyle && (
        <div
          className="pointer-events-none fixed inset-0 z-0 transition-[background] duration-300"
          style={glassOverlayStyle}
        />
      )}
      {/* Unfocused veil — subtle dim/brighten on macOS liquid glass when window loses focus */}
      {isNativeGlass && (
        <div
          className={`pointer-events-none fixed inset-0 z-0 transition-opacity duration-300 ${windowFocused ? "opacity-0" : "opacity-100"}`}
          style={{ background: isLightGlass ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.34)" }}
        />
      )}
      <AppSidebar
        isOpen={sidebar.isOpen}
        islandLayout={settings.islandLayout}
        projects={projectManager.projects}
        sessions={manager.sessions}
        activeSessionId={manager.activeSessionId}
        jiraBoardProjectId={jiraBoardProjectId}
        jiraBoardEnabled={jiraBoardEnabled}
        foldersByProject={o.foldersByProject}
        organizeByChatBranch={settings.organizeByChatBranch}
        onNewChat={handleOpenNewChat}
        onToggleProjectJiraBoard={handleToggleProjectJiraBoard}
        onSelectSession={handleSidebarSelectSession}
        onDeleteSession={manager.deleteSession}
        onRenameSession={manager.renameSession}
        onCreateProject={handleCreateProject}
        onDeleteProject={projectManager.deleteProject}
        onRenameProject={projectManager.renameProject}
        onUpdateProjectIcon={projectManager.updateProjectIcon}
        onImportCCSession={handleImportCCSession}
        onToggleSidebar={sidebar.toggle}
        onNavigateToMessage={handleNavigateToMessage}
        onMoveProjectToSpace={handleMoveProjectToSpace}
        onReorderProject={projectManager.reorderProject}
        onPinSession={o.handlePinSession}
        onMoveSessionToFolder={o.handleMoveSessionToFolder}
        onCreateFolder={o.handleCreateFolder}
        onRenameFolder={o.handleRenameFolder}
        onDeleteFolder={o.handleDeleteFolder}
        onPinFolder={o.handlePinFolder}
        onSetOrganizeByChatBranch={settings.setOrganizeByChatBranch}
        spaces={spaceManager.spaces}
        activeSpaceId={spaceManager.activeSpaceId}
        onSelectSpace={spaceManager.setActiveSpaceId}
        onStartCreateSpace={handleStartCreateSpace}
        onUpdateSpace={handleUpdateSpace}
        onDeleteSpace={handleDeleteSpace}
        onOpenSettings={() => setShowSettings(true)}
        draftSpaceId={draftSpaceId}
        onConfirmCreateSpace={handleConfirmCreateSpace}
        onCancelCreateSpace={handleCancelCreateSpace}
        agents={agents}
        onOpenInSplitView={(sessionId) => {
          void requestAddSplitSession(sessionId);
        }}
        canOpenSessionInSplitView={(sessionId) => splitView.canShowSessionSplitAction(sessionId, manager.activeSessionId)}
      />

      <div ref={contentRef} className={`flex min-w-0 flex-1 flex-col ${settings.islandLayout ? "m-[var(--island-gap)]" : sidebar.isOpen ? "flat-divider-s" : ""} ${isResizing ? "select-none" : ""}`}>
        {showSettings && (
          <SettingsView
            onClose={() => setShowSettings(false)}
            agents={agents}
            onSaveAgent={saveAgent}
            onDeleteAgent={deleteAgent}
            theme={settings.theme}
            onThemeChange={settings.setTheme}
            islandLayout={settings.islandLayout}
            onIslandLayoutChange={settings.setIslandLayout}
            islandShine={settings.islandShine}
            onIslandShineChange={settings.setIslandShine}
            macBackgroundEffect={settings.macBackgroundEffect}
            onMacBackgroundEffectChange={settings.setMacBackgroundEffect}
            autoGroupTools={settings.autoGroupTools}
            onAutoGroupToolsChange={settings.setAutoGroupTools}
            avoidGroupingEdits={settings.avoidGroupingEdits}
            onAvoidGroupingEditsChange={settings.setAvoidGroupingEdits}
            autoExpandTools={settings.autoExpandTools}
            onAutoExpandToolsChange={settings.setAutoExpandTools}
            expandEditToolCallsByDefault={settings.expandEditToolCallsByDefault}
            onExpandEditToolCallsByDefaultChange={settings.setExpandEditToolCallsByDefault}
            transparentToolPicker={settings.transparentToolPicker}
            onTransparentToolPickerChange={settings.setTransparentToolPicker}
            coloredSidebarIcons={settings.coloredSidebarIcons}
            onColoredSidebarIconsChange={settings.setColoredSidebarIcons}
            showToolIcons={settings.showToolIcons}
            onShowToolIconsChange={settings.setShowToolIcons}
            coloredToolIcons={settings.coloredToolIcons}
            onColoredToolIconsChange={settings.setColoredToolIcons}
            transparency={settings.transparency}
            onTransparencyChange={settings.setTransparency}
            glassSupported={glassSupported}
            macLiquidGlassSupported={macLiquidGlassSupported}
            sidebarOpen={sidebar.isOpen}
            onToggleSidebar={sidebar.toggle}
            onReplayWelcome={handleReplayWelcome}
          />
        )}
        {/* Keep chat area mounted (hidden) when settings is open to avoid
            destroying/recreating the entire ChatView DOM tree on toggle */}
        <div className={showSettings ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        {/* ── Top row: Split View OR (Chat | Right Panel | Tools Column | ToolPicker) ── */}
        <div
          ref={(element) => {
            topRowRef.current = element;
            if (!isSplitActive) {
              splitContainerRef.current = element;
            }
          }}
          className="relative flex min-h-0 flex-1"
          onDragEnter={!isSplitActive ? splitDragDrop.handleDragEnter : undefined}
          onDragOver={!isSplitActive
            ? (mainToolDrag
              ? ((event: React.DragEvent<HTMLDivElement>) => {
                const rect = event.currentTarget.getBoundingClientRect();
                if (!isNearBottomDockZone(rect, event.clientY)) return;
                event.preventDefault();
                setMainToolDrag((current) => current ? {
                  ...current,
                  targetArea: "bottom",
                  targetIndex: mainToolWorkspace.bottomToolIslands.length,
                  targetColumnId: null,
                } : current);
              })
              : splitDragDrop.handleDragOver)
            : undefined}
          onDragLeave={!isSplitActive ? splitDragDrop.handleDragLeave : undefined}
          onDrop={!isSplitActive ? splitDragDrop.handleDrop : undefined}
        >

          {/* ══════ SPLIT VIEW RENDERING ══════ */}
          {isSplitActive ? (
            <LayoutGroup id="split-view-layout">
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-col"
                onDragOver={(event) => {
                  if (!splitToolDrag || splitBottomToolIslands.length > 0) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const bottomZoneHeight = Math.min(180, rect.height * 0.28);
                  if (event.clientY < rect.bottom - bottomZoneHeight) return;
                  event.preventDefault();
                  setSplitToolDrag((current) => current ? {
                    ...current,
                    targetArea: "bottom",
                    targetIndex: 0,
                  } : current);
                }}
              >
                <div
                  ref={splitContainerRef}
                  className="flex min-h-0 min-w-0 flex-1"
                  onDragEnter={!splitToolDrag ? splitDragDrop.handleDragEnter : undefined}
                  onDragOver={!splitToolDrag ? splitDragDrop.handleDragOver : undefined}
                  onDragLeave={!splitToolDrag ? splitDragDrop.handleDragLeave : undefined}
                  onDrop={!splitToolDrag ? splitDragDrop.handleDrop : undefined}
                >
                  {topRowRenderEntries.map((entry, displayIndex) => {
                    const isToolPreviewMode = !!splitToolDrag && splitToolDrag.targetArea !== null;
                    const ghostBeforeThisPane = !isToolPreviewMode && previewDropPosition !== null && previewDropPosition <= displayIndex;
                    const panePreviewIndex = isToolPreviewMode ? displayIndex : (ghostBeforeThisPane ? displayIndex + 1 : displayIndex);
                    const dropZonePreviewIndex = previewDropPosition ?? splitTopRowItems.length;
                    const dropZoneMetrics = getPreviewPaneMetrics(dropZonePreviewIndex);
                    const dropZoneStyle = {
                      width: `calc(${dropZoneMetrics.widthPercent}% - ${dropZoneMetrics.handleSharePx}px + ${SPLIT_HANDLE_WIDTH}px)`,
                      minWidth: MIN_CHAT_WIDTH_SPLIT,
                    } as React.CSSProperties;
                    const previewPaneMetrics = getPreviewPaneMetrics(displayIndex);
                    const previewPaneStyle = {
                      width: `calc(${previewPaneMetrics.widthPercent}% - ${previewPaneMetrics.handleSharePx}px)`,
                      minWidth: MIN_CHAT_WIDTH_SPLIT,
                    } as React.CSSProperties;
                    const insertBeforeIndex = topRowRenderEntries
                      .slice(0, displayIndex)
                      .filter((candidate) => candidate.kind === "item")
                      .length;

                    return (
                      <React.Fragment key={entry.kind === "item" ? entry.item.itemId : `split-tool-preview-${displayIndex}`}>
                        {displayIndex === 0 && !splitToolDrag && splitDragDrop.dragState.isDragging && splitDragDrop.dragState.dropPosition === 0 && (
                          <SplitDropZone
                            active={true}
                            session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                            style={dropZoneStyle}
                          />
                        )}

                        {displayIndex > 0 && (
                          <>
                            {!splitToolDrag && splitDragDrop.dragState.isDragging && splitDragDrop.dragState.dropPosition === displayIndex && (
                              <SplitDropZone
                                active={true}
                                session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                                style={dropZoneStyle}
                              />
                            )}
                            <SplitHandle
                              isIsland={isIsland}
                              isResizing={paneResize.isResizing || isSplitBottomHeightResizing}
                              onResizeStart={(event) => paneResize.handleSplitResizeStart(displayIndex - 1, event)}
                              onDoubleClick={paneResize.handleSplitDoubleClick}
                            />
                          </>
                        )}

                        {entry.kind === "preview" ? (
                          <SplitDropZone
                            active={true}
                            label={splitToolLabel ?? undefined}
                            style={previewPaneStyle}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setSplitToolDrag((current) => current ? {
                                ...current,
                                targetArea: "top",
                                targetIndex: displayIndex,
                              } : current);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              commitSplitToolDrop();
                            }}
                          />
                        ) : (
                          renderSplitTopRowItem(entry.item, displayIndex, panePreviewIndex, insertBeforeIndex)
                        )}

                        {displayIndex === topRowRenderEntries.length - 1 && !splitToolDrag
                          && splitDragDrop.dragState.isDragging
                          && splitDragDrop.dragState.dropPosition === splitTopRowItems.length
                          && (
                            <SplitDropZone
                              active={true}
                              session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                              style={dropZoneStyle}
                            />
                          )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {(splitBottomToolIslands.length > 0 || splitToolDrag?.targetArea === "bottom") && (
                  <>
                    <div
                      className="resize-row flat-divider-soft group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                      style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                      onMouseDown={splitBottomToolIslands.length > 0 ? splitBottomHeightResize.handleResizeStart : undefined}
                    >
                      <div
                        className={`h-0.5 w-10 rounded-full transition-colors duration-150 ${
                          isResizing || isSplitBottomHeightResizing
                            ? "bg-foreground/40"
                            : "bg-transparent group-hover:bg-foreground/25"
                        }`}
                      />
                    </div>
                    <div
                      ref={splitBottomRowRef}
                      className="flex shrink-0 overflow-hidden"
                      style={{ height: splitBottomToolIslands.length > 0 ? splitView.bottomHeight : 120 }}
                    >
                      {bottomRowRenderEntries.length === 0 && splitToolDrag?.targetArea === "bottom" && (
                        <div
                          className="flex min-h-0 flex-1 px-6 pb-1"
                          onDragOver={(event) => {
                            event.preventDefault();
                            setSplitToolDrag((current) => current ? {
                              ...current,
                              targetArea: "bottom",
                              targetIndex: 0,
                            } : current);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            commitSplitToolDrop();
                          }}
                        >
                          <PanelDockPreview orientation="horizontal" label={splitToolLabel ?? undefined} className="mx-auto h-16 w-full max-w-[420px]" />
                        </div>
                      )}
                      {bottomRowRenderEntries.map((entry, displayIndex) => {
                        const fraction = previewBottomRowFractions[displayIndex] ?? (1 / Math.max(bottomRowRenderEntries.length, 1));
                        const insertBeforeIndex = bottomRowRenderEntries
                          .slice(0, displayIndex)
                          .filter((candidate) => candidate.kind === "item")
                          .length;

                        return (
                          <React.Fragment key={entry.kind === "item" ? entry.island.id : `split-bottom-preview-${displayIndex}`}>
                            {entry.kind === "preview" ? (
                              <div
                                className="mx-1 flex min-h-0"
                                style={{ flex: `${fraction} 1 0%`, minWidth: 0 }}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  setSplitToolDrag((current) => current ? {
                                    ...current,
                                    targetArea: "bottom",
                                    targetIndex: insertBeforeIndex,
                                  } : current);
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  commitSplitToolDrop();
                                }}
                              >
                                <PanelDockPreview orientation="horizontal" label={splitToolLabel ?? undefined} className="min-h-0 flex-1" />
                              </div>
                            ) : (
                              renderSplitBottomToolIsland(entry.island, fraction, insertBeforeIndex)
                            )}
                            {displayIndex < bottomRowRenderEntries.length - 1 && (
                              <SplitHandle
                                isIsland={isIsland}
                                isResizing={splitBottomPaneResize.isResizing}
                                onResizeStart={(event) => splitBottomPaneResize.handleSplitResizeStart(displayIndex, event)}
                                onDoubleClick={splitBottomPaneResize.handleSplitDoubleClick}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </LayoutGroup>
          ) : (
          /* ══════ NORMAL (SINGLE PANE) RENDERING ══════ */
          <>
          {showSinglePaneSplitPreview && singlePanePreviewPosition === 0 && (
            <>
              <SplitDropZone
                active={true}
                session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                style={singlePanePreviewPaneStyle}
              />
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.65 }}
                className="flex w-2 shrink-0 items-center justify-center"
                style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
              >
                <div className="h-10 w-0.5 rounded-full bg-foreground/18" />
              </motion.div>
            </>
          )}

          <motion.div
            layout={shouldAnimateTopRowLayout}
            transition={shouldAnimateTopRowLayout
              ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
              : { duration: 0 }}
            ref={(el) => {
              (chatIslandRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className={`chat-island island relative flex min-w-0 flex-col overflow-hidden rounded-[var(--island-radius)] bg-background ${
              showSinglePaneSplitPreview ? "shrink-0" : "flex-1"
            }`}
            style={(showSinglePaneSplitPreview
              ? {
                  ...singlePanePreviewPaneStyle,
                  "--chat-fade-strength": String(chatFadeStrength),
                }
              : {
                  minWidth: mainWorkspaceChatMinWidth,
                  "--chat-fade-strength": String(chatFadeStrength),
                }) as React.CSSProperties}
          >
            {jiraBoardProject ? (
              <JiraBoardPanel
                projectId={jiraBoardProject.id}
                projectName={jiraBoardProject.name}
                variant="main"
                onClose={() => setJiraBoardProjectForSpace(spaceManager.activeSpaceId, null)}
                sidebarOpen={sidebar.isOpen}
                onToggleSidebar={sidebar.toggle}
                onCreateTask={handleCreateTaskFromJiraIssue}
              />
            ) : manager.activeSessionId ? (
              <>
              {/* Top fade: only visible when chat is scrolled down. Island mode uses dark shadow; flat mode fades content into bg */}
              {/* Island: gradient starts at top-0 (behind header, subtle bleed). Flat: starts at top-10 (right below header) so full gradient is visible and strong. */}
              <div
                className={`pointer-events-none absolute inset-x-0 top-0 z-[5] ${
                  isIsland ? "h-20" : "h-24"
                }`}
                style={{
                  opacity: "calc(var(--chat-fade-strength, 1) * var(--chat-top-progress, 0))",
                  background: topFadeBackground,
                }}
              />
              <div
                className="chat-titlebar-bg pointer-events-none absolute inset-x-0 top-0 z-10"
                style={{ background: titlebarSurfaceColor }}
              >
                <ChatHeader
                  islandLayout={isIsland}
                  sidebarOpen={sidebar.isOpen}
                  showSidebarToggle={true}
                  isProcessing={manager.isProcessing}
                  model={activePaneCtrl?.paneHeaderModel}
                  sessionId={manager.sessionInfo?.sessionId}
                  totalCost={manager.totalCost}
                  title={manager.activeSession?.title}
                  titleGenerating={manager.activeSession?.titleGenerating}
                  planMode={activePaneCtrl?.panePlanMode ?? settings.planMode}
                  permissionMode={activePaneCtrl?.panePermissionMode}
                  acpPermissionBehavior={manager.activeSession?.engine === "acp" ? settings.acpPermissionBehavior : undefined}
                  onToggleSidebar={sidebar.toggle}
                  showDevFill={devFillEnabled}
                  onSeedDevExampleConversation={manager.seedDevExampleConversation}
                  onSeedDevExampleSpaceData={handleSeedDevExampleSpaceData}
                />
              </div>
              {chatSearchOpen && (
                <ChatSearchBar
                  messages={manager.messages}
                  onNavigate={setScrollToMessageId}
                  onClose={() => setChatSearchOpen(false)}
                />
              )}
              <ChatView
                spaceId={spaceManager.activeSpaceId}
                messages={manager.messages}
                isProcessing={manager.isProcessing}
                showThinking={showThinking}
                autoGroupTools={settings.autoGroupTools}
                avoidGroupingEdits={settings.avoidGroupingEdits}
                autoExpandTools={settings.autoExpandTools}
                expandEditToolCallsByDefault={settings.expandEditToolCallsByDefault}
                showToolIcons={settings.showToolIcons}
                coloredToolIcons={settings.coloredToolIcons}
                extraBottomPadding={!!manager.pendingPermission}
                scrollToMessageId={scrollToMessageId}
                onScrolledToMessage={handleScrolledToMessage}
                sessionId={manager.activeSessionId}
                onRevert={manager.isConnected && manager.revertFiles ? handleRevert : undefined}
                onFullRevert={manager.isConnected && manager.fullRevert ? handleFullRevert : undefined}
                onTopScrollProgress={handleTopScrollProgress}
                onSendQueuedNow={handleSendQueuedNow}
                onUnqueueQueuedMessage={handleUnqueueMessage}
                sendNextId={manager.sendNextId}
                agents={agents}
                selectedAgent={selectedAgent}
                onAgentChange={handleAgentChange}
              />
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
                style={{
                  opacity: chatFadeStrength,
                  background: bottomFadeBackground,
                }}
              />
              <div data-chat-composer className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
                <BottomComposer
                  pendingPermission={manager.pendingPermission}
                  onRespondPermission={manager.respondPermission}
                  onSend={wrappedHandleSend}
                  onClear={handleComposerClear}
                  onStop={handleStop}
                  isProcessing={manager.isProcessing}
                  queuedCount={manager.queuedCount}
                  model={activePaneCtrl?.paneModel ?? settings.model}
                  claudeEffort={activePaneCtrl?.paneClaudeEffort ?? settings.claudeEffort}
                  planMode={activePaneCtrl?.panePlanMode ?? settings.planMode}
                  permissionMode={activePaneCtrl?.panePermissionMode ?? (manager.sessionInfo?.permissionMode ?? settings.permissionMode)}
                  onModelChange={activePaneCtrl?.handlePaneModelChange ?? handleModelChange}
                  onClaudeModelEffortChange={activePaneCtrl?.handlePaneClaudeModelEffortChange ?? handleClaudeModelEffortChange}
                  onPlanModeChange={activePaneCtrl?.handlePanePlanModeChange ?? handlePlanModeChange}
                  onPermissionModeChange={activePaneCtrl?.handlePanePermissionModeChange ?? handlePermissionModeChange}
                  projectPath={activeProjectPath}
                  contextUsage={manager.contextUsage}
                  isCompacting={manager.isCompacting}
                  onCompact={manager.compact}
                  agents={agents}
                  selectedAgent={activePaneCtrl?.selectedPaneAgent ?? selectedAgent}
                  onAgentChange={activePaneCtrl?.handlePaneAgentChange ?? handleAgentChange}
                  slashCommands={activePaneCtrl?.paneSlashCommands ?? manager.slashCommands}
                  acpConfigOptions={activePaneCtrl?.paneAcpConfigOptions ?? manager.acpConfigOptions}
                  acpConfigOptionsLoading={activePaneCtrl?.paneAcpConfigOptionsLoading ?? manager.acpConfigOptionsLoading}
                  onACPConfigChange={activePaneCtrl?.handlePaneAcpConfigChange ?? manager.setACPConfig}
                  acpPermissionBehavior={settings.acpPermissionBehavior}
                  onAcpPermissionBehaviorChange={settings.setAcpPermissionBehavior}
                  supportedModels={activePaneCtrl?.paneSupportedModels ?? manager.supportedModels}
                  codexModelsLoadingMessage={activePaneCtrl?.paneCodexModelsLoadingMessage ?? manager.codexModelsLoadingMessage}
                  codexEffort={activePaneCtrl?.paneCodexEffort ?? manager.codexEffort}
                  onCodexEffortChange={activePaneCtrl?.handlePaneCodexEffortChange ?? manager.setCodexEffort}
                  codexModelData={manager.codexRawModels}
                  grabbedElements={grabbedElements}
                  onRemoveGrabbedElement={handleRemoveGrabbedElement}
                  lockedEngine={lockedEngine}
                  lockedAgentId={lockedAgentId}
                  selectedWorktreePath={activeSpaceTerminalCwd}
                  onSelectWorktree={handleAgentWorktreeChange}
                  isEmptySession={manager.messages.length === 0}
                  isIslandLayout={isIsland}
                />
              </div>
              </>
            ) : (
              <>
              <div
                className={`chat-titlebar-bg drag-region flex items-center ${
                  isIsland ? "h-12 px-3" : "h-[3.25rem] px-4"
                } ${
                  !sidebar.isOpen && isMac ? (isIsland ? "ps-[78px]" : "ps-[84px]") : ""
                }`}
                style={{ background: titlebarSurfaceColor }}
              >
                {!sidebar.isOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground ${
                      isIsland ? "relative -top-[5px]" : ""
                    }`}
                    onClick={sidebar.toggle}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {isSpaceSwitching ? (
                <div className="flex min-h-0 flex-1 flex-col px-8 py-10">
                  <div className="w-48 animate-pulse rounded-full bg-foreground/8 h-4" />
                  <div className="mt-8 space-y-4">
                    <div className="h-12 animate-pulse rounded-2xl bg-foreground/6" />
                    <div className="h-28 animate-pulse rounded-3xl bg-foreground/5" />
                    <div className="h-12 animate-pulse rounded-2xl bg-foreground/6" />
                    <div className="h-20 animate-pulse rounded-3xl bg-foreground/5" />
                  </div>
                  <div className="mt-auto h-24 animate-pulse rounded-[28px] bg-foreground/6" />
                </div>
              ) : (
                <WelcomeScreen
                  hasProjects={hasProjects}
                  onCreateProject={handleCreateProject}
                />
              )}
              </>
            )}
          </motion.div>

          {showSinglePaneSplitPreview && singlePanePreviewPosition === 1 && (
            <>
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.65 }}
                className="flex w-2 shrink-0 items-center justify-center"
                style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
              >
                <div className="h-10 w-0.5 rounded-full bg-foreground/18" />
              </motion.div>
              <SplitDropZone
                active={true}
                session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                style={singlePanePreviewPaneStyle}
              />
            </>
          )}

          {hasRightPanel && (
            <motion.div
              layout={shouldAnimateTopRowLayout}
              transition={shouldAnimateTopRowLayout
                ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
                : { duration: 0 }}
              className={`flex shrink-0 overflow-hidden ${showSinglePaneSplitPreview ? "pointer-events-none opacity-0" : ""}`}
              style={showSinglePaneSplitPreview ? { width: 0, minWidth: 0 } : undefined}
            >
              <RightPanel
                isIsland={isIsland}
                isResizing={isResizing}
                rightPanelRef={rightPanelRef}
                rightPanelWidth={settings.rightPanelWidth}
                rightSplitRatio={settings.rightSplitRatio}
                splitGap={splitGap}
                handleResizeStart={handleResizeStart}
                handleRightSplitStart={handleRightSplitStart}
                hasTodos={hasTodos}
                hasAgents={hasAgents}
                activeTools={activeTools}
                activeTodos={activeTodos}
                bgAgents={bgAgents}
                expandEditToolCallsByDefault={settings.expandEditToolCallsByDefault}
              />
            </motion.div>
          )}

          {manager.activeSessionId && (
            <MainTopToolArea
              isIsland={isIsland}
              shouldAnimateTopRowLayout={shouldAnimateTopRowLayout}
              showSinglePaneSplitPreview={showSinglePaneSplitPreview}
              toolAreaWidth={mainToolAreaWidth}
              isOuterResizeActive={isMainToolAreaResizing}
              workspace={mainToolWorkspace}
              mainToolDrag={mainToolDrag}
              setMainToolDrag={setMainToolDrag}
              mainDraggedIsland={mainDraggedIsland}
              mainToolLabel={mainToolLabel}
              canAddMainTopColumn={canAddMainTopColumn}
              onOuterResizeStart={handleMainToolAreaResizeStart}
              onCommitDrop={commitMainToolDrop}
              onResetDrag={resetMainToolDrag}
              renderToolContent={renderMainWorkspaceToolContent}
              topAreaRef={mainToolAreaRef}
              toolsColumnRef={toolsColumnRef}
              topToolColumnRefs={mainTopToolColumnRefs}
              topPaneResize={mainToolPaneResize}
              activeToolColumnResizeId={mainToolColumnResize.activeResizeId}
              onToolColumnResizeStart={mainToolColumnResize.handleResizeStart}
            />
          )}

          {/* Tool picker — always visible */}
          {showToolPicker && (
            <motion.div
              layout={shouldAnimateTopRowLayout}
              transition={shouldAnimateTopRowLayout
                ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
                : { duration: 0 }}
              className={`${isIsland ? "ms-[var(--island-panel-gap)]" : "tool-picker-shell flat-divider-soft"} shrink-0 overflow-hidden ${
                showSinglePaneSplitPreview || isSpaceSwitching && !manager.activeSessionId
                  ? "pointer-events-none"
                  : ""
              }`}
              style={showSinglePaneSplitPreview ? { width: 0, minWidth: 0, marginInlineStart: 0 } : undefined}
            >
              <ToolPicker
                islandLayout={isIsland}
                transparentBackground={settings.transparentToolPicker}
                coloredIcons={settings.coloredSidebarIcons}
                activeTools={mainPickerActiveTools}
                onToggle={(toolId) => {
                  if (toolId === "tasks" || toolId === "agents") {
                    handleToggleTool(toolId);
                    return;
                  }
                  const existing = mainToolWorkspace.getToolIsland(toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">);
                  if (existing) {
                    mainToolWorkspace.closeToolIsland(existing.id);
                    return;
                  }
                  const panelToolId = toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">;
                  const rememberedDock = mainToolWorkspace.getRememberedDock(panelToolId);
                  if (rememberedDock === "bottom") {
                    mainToolWorkspace.openToolIsland(panelToolId, "top");
                    return;
                  }
                  if (canFitToolAsNewColumn(panelToolId) || mainToolWorkspace.topRowItems.length === 0) {
                    mainToolWorkspace.openToolIsland(panelToolId, "top");
                    return;
                  }
                  const lastColumnId = mainToolWorkspace.topRowItems[mainToolWorkspace.topRowItems.length - 1]?.column.id;
                  if (lastColumnId) {
                    mainToolWorkspace.openToolIslandInTopColumn(panelToolId, lastColumnId);
                  } else {
                    mainToolWorkspace.openToolIsland(panelToolId, "top");
                  }
                }}
                availableContextual={availableContextual}
                toolOrder={settings.toolOrder}
                displayBottomTools={new Set<ToolId>(mainToolWorkspace.bottomToolIslands.map((island) => island.toolId))}
                onReorder={handleToolReorder}
                panelInteractionMode="workspace"
                onPanelToolDragStart={(event, toolId) => {
                  event.dataTransfer.setData("text/plain", toolId);
                  event.dataTransfer.effectAllowed = "move";
                  setMainToolDrag({
                    toolId,
                    islandId: null,
                    targetArea: null,
                    targetIndex: null,
                    targetColumnId: null,
                  });
                }}
                onPanelToolDragEnd={resetMainToolDrag}
                projectPath={activeProjectPath}
                bottomTools={new Set<ToolId>(mainToolWorkspace.bottomToolIslands.map((island) => island.toolId))}
                onMoveToBottom={(toolId) => {
                  const existing = mainToolWorkspace.getToolIsland(toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">);
                  if (existing) mainToolWorkspace.moveToolIsland(existing.id, "bottom");
                  else mainToolWorkspace.openToolIsland(toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">, "bottom");
                }}
                onMoveToSide={(toolId) => {
                  const panelToolId = toolId as Extract<ToolId, "terminal" | "browser" | "git" | "files" | "project-files" | "mcp">;
                  const existing = mainToolWorkspace.getToolIsland(panelToolId);
                  if (existing) {
                    if (existing.dock === "top") return;
                    if (canFitToolAsNewColumn(panelToolId) || mainToolWorkspace.topRowItems.length === 0) {
                      mainToolWorkspace.moveToolIsland(existing.id, "top");
                      return;
                    }
                    const lastColumnId = mainToolWorkspace.topRowItems[mainToolWorkspace.topRowItems.length - 1]?.column.id;
                    if (lastColumnId) {
                      mainToolWorkspace.moveToolIslandToTopColumn(existing.id, lastColumnId);
                    }
                    return;
                  }
                  if (canFitToolAsNewColumn(panelToolId) || mainToolWorkspace.topRowItems.length === 0) {
                    mainToolWorkspace.openToolIsland(panelToolId, "top");
                    return;
                  }
                  const lastColumnId = mainToolWorkspace.topRowItems[mainToolWorkspace.topRowItems.length - 1]?.column.id;
                  if (lastColumnId) {
                    mainToolWorkspace.openToolIslandInTopColumn(panelToolId, lastColumnId);
                  }
                }}
                taskProgress={activeTodos.length > 0 ? {
                  completed: activeTodos.filter((t) => t.status === "completed").length,
                  total: activeTodos.length,
                } : undefined}
              />
            </motion.div>
          )}
          </>
          )}
        </div>{/* end top row */}

        {!isSplitActive && manager.activeSessionId && (
          <MainBottomToolDock
            isIsland={isIsland}
            workspace={mainToolWorkspace}
            mainToolDrag={mainToolDrag}
            setMainToolDrag={setMainToolDrag}
            mainDraggedIsland={mainDraggedIsland}
            mainToolLabel={mainToolLabel}
            isResizeActive={isResizing}
            isBottomHeightResizing={isMainBottomHeightResizing}
            bottomRowRef={mainBottomRowRef}
            bottomPaneResize={mainBottomPaneResize}
            onBottomResizeStart={mainBottomHeightResize.handleResizeStart}
            onCommitDrop={commitMainToolDrop}
            onResetDrag={resetMainToolDrag}
            renderToolContent={renderMainWorkspaceToolContent}
            onMoveBottomToolToTop={moveMainBottomToolToTop}
          />
        )}
        </div>{/* end showSettings wrapper */}
      </div>
      {showCodexAuthDialog && (
        <CodexAuthDialog
          sessionId={manager.activeSessionId!}
          onComplete={() => manager.clearCodexAuthRequired()}
          onCancel={() => manager.clearCodexAuthRequired()}
        />
      )}
      {showAcpAuthDialog && (
        <ACPAuthDialog
          sessionId={manager.acpAuthSessionId!}
          agentId={manager.acpAuthAgentId}
          agentName={acpAuthAgentName}
          authMethods={manager.acpAuthMethods}
          onComplete={(result) => manager.completeAcpAuth(result)}
          onCancel={manager.cancelAcpAuth}
        />
      )}
      <FilePreviewOverlay
        filePath={previewFile?.path ?? null}
        sourceRect={previewFile?.sourceRect ?? null}
        onClose={handleClosePreview}
      />
      {/* Welcome wizard — full-screen overlay on first run */}
      {!welcomeCompleted && (
        <WelcomeWizard
          theme={settings.theme}
          onThemeChange={settings.setTheme}
          islandLayout={settings.islandLayout}
          onIslandLayoutChange={settings.setIslandLayout}
          autoGroupTools={settings.autoGroupTools}
          onAutoGroupToolsChange={settings.setAutoGroupTools}
          autoExpandTools={settings.autoExpandTools}
          onAutoExpandToolsChange={settings.setAutoExpandTools}
          expandEditToolCallsByDefault={settings.expandEditToolCallsByDefault}
          onExpandEditToolCallsByDefaultChange={settings.setExpandEditToolCallsByDefault}
          transparency={settings.transparency}
          onTransparencyChange={settings.setTransparency}
          glassSupported={glassSupported}
          permissionMode={settings.permissionMode}
          onPermissionModeChange={handlePermissionModeChange}
          onCreateProject={handleCreateProject}
          hasProjects={hasProjects}
          agents={agents}
          onSaveAgent={saveAgent}
          onDeleteAgent={deleteAgent}
          onComplete={handleWelcomeComplete}
        />
      )}
    </div>
  );
}
