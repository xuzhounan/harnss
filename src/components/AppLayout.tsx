import React, { useCallback, useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { PanelLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { normalizeRatios } from "@/hooks/useSettings";
import { useAppOrchestrator } from "@/hooks/useAppOrchestrator";
import { useSpaceTheme } from "@/hooks/useSpaceTheme";
import { usePanelResize } from "@/hooks/usePanelResize";
import {
  ISLAND_CONTROL_RADIUS,
  ISLAND_GAP,
  ISLAND_PANEL_GAP,
  ISLAND_RADIUS,
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
import { TodoPanel } from "./TodoPanel";
import { BackgroundAgentsPanel } from "./BackgroundAgentsPanel";
import { ToolPicker } from "./ToolPicker";
import { WelcomeScreen } from "./WelcomeScreen";
import { WelcomeWizard } from "./welcome/WelcomeWizard";
import { WELCOME_COMPLETED_KEY } from "./welcome/shared";
import { ToolsPanel } from "./ToolsPanel";
import { BrowserPanel } from "./BrowserPanel";
import { GitPanel } from "./GitPanel";
import { FilesPanel } from "./FilesPanel";
import { McpPanel } from "./McpPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { FilePreviewOverlay } from "./FilePreviewOverlay";
import { SettingsView } from "./SettingsView";
import { CodexAuthDialog } from "./CodexAuthDialog";
import { JiraBoardPanel } from "./JiraBoardPanel";
import type { JiraIssue } from "@shared/types/jira";
import { isMac, isWindows } from "@/lib/utils";
import { SplitHandle } from "./split/SplitHandle";
import { SplitDropZone } from "./split/SplitDropZone";
import { PaneToolDrawer } from "./split/PaneToolDrawer";
import { SplitPaneHost } from "./split/SplitPaneHost";
import { buildCodexCollabMode } from "@/hooks/session/types";
import { usePaneResize } from "@/hooks/usePaneResize";
import { useSplitDragDrop } from "@/hooks/useSplitDragDrop";
import { MIN_CHAT_WIDTH_SPLIT, SPLIT_HANDLE_WIDTH } from "@/lib/layout-constants";
import { getMaxVisibleSplitPaneCount } from "@/lib/split-layout";
import { getStoredProjectGitCwd } from "@/lib/space-projects";

const JIRA_BOARD_BY_SPACE_KEY = "harnss-jira-board-by-space";

function readJiraBoardBySpace(): Record<string, string> {
  try {
    const raw = localStorage.getItem(JIRA_BOARD_BY_SPACE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function AppLayout() {
  const o = useAppOrchestrator();
  const {
    sidebar, projectManager, spaceManager, manager, settings, resolvedTheme,
    agents, selectedAgent, saveAgent, deleteAgent, handleAgentChange,
    lockedEngine, lockedAgentId,
    activeProjectId, activeProjectPath, activeSpaceProject, activeSpaceTerminalCwd, showThinking,
    hasProjects, isSpaceSwitching, showToolPicker, hasRightPanel, hasToolsColumn, hasBottomTools,
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
  const isGlassActive = glassSupported && settings.transparency;
  const isLightGlass = isGlassActive && resolvedTheme !== "dark";
  const isNativeGlass = isGlassActive && isMac && liveMacBackgroundEffect === "liquid-glass";

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

  const [jiraBoardBySpace, setJiraBoardBySpace] = useState<Record<string, string>>(() => readJiraBoardBySpace());
  const jiraBoardProjectId = jiraBoardEnabled
    ? (jiraBoardBySpace[spaceManager.activeSpaceId] ?? null)
    : null;
  const jiraBoardProject = jiraBoardProjectId
    ? projectManager.projects.find((project) => project.id === jiraBoardProjectId) ?? null
    : null;
  const [pendingJiraTask, setPendingJiraTask] = useState<{ projectId: string; message: string } | null>(null);

  const setJiraBoardProjectForSpace = useCallback((spaceId: string, projectId: string | null) => {
    setJiraBoardBySpace((prev) => {
      const next = { ...prev };
      if (projectId) {
        next[spaceId] = projectId;
      } else {
        delete next[spaceId];
      }
      localStorage.setItem(JIRA_BOARD_BY_SPACE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

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

  const handleToggleProjectJiraBoard = useCallback((projectId: string) => {
    const project = projectManager.projects.find((item) => item.id === projectId);
    if (!project) return;
    const spaceId = project.spaceId || "default";
    const currentProjectId = jiraBoardBySpace[spaceId];
    setJiraBoardProjectForSpace(spaceId, currentProjectId === projectId ? null : projectId);
  }, [jiraBoardBySpace, projectManager.projects, setJiraBoardProjectForSpace]);

  // Handler for creating task from Jira issue
  const handleCreateTaskFromJiraIssue = useCallback(
    (projectId: string, issue: JiraIssue) => {
      const taskMessage = `Please help me work on this Jira issue:

**${issue.key}: ${issue.summary}**

${issue.description ? `\n${issue.description}\n` : ""}
${issue.assignee ? `Assigned to: ${issue.assignee.displayName}\n` : ""}
Status: ${issue.status}
${issue.priority ? `Priority: ${issue.priority.name}\n` : ""}

Link: ${issue.url}`;

      const project = projectManager.projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }

      if (activeProjectId === projectId && manager.activeSessionId) {
        handleSend(taskMessage);
        return;
      }

      setPendingJiraTask({ projectId, message: taskMessage });
      void handleNewChat(projectId);
    },
    [activeProjectId, handleNewChat, handleSend, manager.activeSessionId, projectManager.projects, setJiraBoardProjectForSpace],
  );

  useEffect(() => {
    setJiraBoardBySpace((prev) => {
      let changed = false;
      const next: Record<string, string> = {};

      for (const [spaceId, projectId] of Object.entries(prev)) {
        const project = projectManager.projects.find((item) => item.id === projectId);
        if (!project) {
          changed = true;
          continue;
        }
        const projectSpaceId = project.spaceId || "default";
        if (next[projectSpaceId] !== projectId) {
          next[projectSpaceId] = projectId;
        }
        if (projectSpaceId !== spaceId) {
          changed = true;
        }
      }

      if (!changed && Object.keys(next).length === Object.keys(prev).length) {
        return prev;
      }
      localStorage.setItem(JIRA_BOARD_BY_SPACE_KEY, JSON.stringify(next));
      return next;
    });
  }, [projectManager.projects]);

  useEffect(() => {
    if (!pendingJiraTask) return;
    if (activeProjectId !== pendingJiraTask.projectId || !manager.activeSessionId) return;
    setPendingJiraTask(null);
    handleSend(pendingJiraTask.message);
  }, [activeProjectId, handleSend, manager.activeSessionId, pendingJiraTask]);

  useEffect(() => {
    if (jiraBoardEnabled) return;
    setJiraBoardBySpace((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      localStorage.removeItem(JIRA_BOARD_BY_SPACE_KEY);
      return {};
    });
  }, [jiraBoardEnabled]);

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
    hasToolsColumn,
    activeSessionId: manager.activeSessionId,
    activeProjectId,
  });
  const {
    isResizing, contentRef, rightPanelRef, toolsColumnRef, bottomToolsRowRef,
    normalizedToolRatiosRef, normalizedBottomRatiosRef,
    handleResizeStart, handleToolsResizeStart, handleToolsSplitStart, handleRightSplitStart,
    handleBottomResizeStart, handleBottomSplitStart,
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

  const isSplitActive = splitView.enabled;
  const splitPaneSessionIds = splitView.visibleSessionIds;
  const previousActiveSplitSessionIdRef = useRef<string | null>(manager.activeSessionId);

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
    canAcceptDrop: !!manager.activeSessionId && splitView.paneCount < maxSplitPaneCount,
    containerRef: splitContainerRef,
    widthFractions: splitView.widthFractions,
    onDrop: (sessionId, position) => {
      requestAddSplitSession(sessionId, position);
    },
    visibleSessionIds,
  });
  const previewDropPosition = splitDragDrop.dragState.isDragging ? splitDragDrop.dragState.dropPosition : null;
  const previewPaneCount = previewDropPosition === null ? splitView.paneCount : splitView.paneCount + 1;
  const previewWidthFractions = useMemo(
    () => previewDropPosition === null ? splitView.widthFractions : equalWidthFractions(previewPaneCount),
    [previewDropPosition, previewPaneCount, splitView.widthFractions],
  );

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

  // Memoize per-pane scroll callbacks (stable across renders)
  const paneScrollCallbacks = useMemo(
    () => splitPaneSessionIds.map((_, index) => makePaneScrollCallback(index)),
    [makePaneScrollCallback, splitPaneSessionIds],
  );

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

  // Scroll fades should soften when the space itself is more transparent.
  const spaceOpacity = spaceManager.activeSpace?.color.opacity ?? 1;
  const chatFadeStrength = Math.max(0.2, Math.min(1, spaceOpacity));

  const chatSurfaceColor = isLightGlass
    ? "color-mix(in oklab, white 97%, var(--background) 3%)"
    : "var(--background)";
  // Keep titlebar veil/shadow behavior consistent across island and non-island layouts.
  const titlebarOpacity = isLightGlass
    ? Math.round(69 + 14 * spaceOpacity)
    : Math.round(23 + 35 * spaceOpacity);
  const topFadeShadowOpacity = isLightGlass
    ? Math.round(13 + 15 * spaceOpacity)
    : Math.round(21 + 26 * spaceOpacity);
  const titlebarSurfaceColor =
    `linear-gradient(to bottom, color-mix(in oklab, ${chatSurfaceColor} ${titlebarOpacity}%, transparent) 0%, color-mix(in oklab, ${chatSurfaceColor} ${Math.max(titlebarOpacity - 3, 23)}%, transparent) 34%, color-mix(in oklab, ${chatSurfaceColor} ${Math.max(titlebarOpacity - 14, 11)}%, transparent) 68%, transparent 100%)`;
  const topFadeBackground = isIsland
    ? `linear-gradient(to bottom, color-mix(in oklab, ${chatSurfaceColor} 100%, black 4.5%) 0%, color-mix(in oklab, ${chatSurfaceColor} 97.5%, black 1.75%) 18%, color-mix(in oklab, ${chatSurfaceColor} 93.5%, transparent) 48%, transparent 100%), radial-gradient(138% 88% at 50% 0%, color-mix(in srgb, black ${topFadeShadowOpacity}%, transparent) 0%, transparent 70%)`
    : `linear-gradient(to bottom, ${chatSurfaceColor} 0%, ${chatSurfaceColor} 34%, color-mix(in oklab, ${chatSurfaceColor} 90.5%, transparent) 60%, transparent 100%), radial-gradient(142% 92% at 50% 0%, color-mix(in srgb, black ${topFadeShadowOpacity}%, transparent) 0%, transparent 72%)`;
  const bottomFadeBackground = `linear-gradient(to top, ${chatSurfaceColor}, transparent)`;
  const activeSessionProject = manager.activeSession
    ? projectManager.projects.find((project) => project.id === manager.activeSession?.projectId) ?? null
    : null;
  const activeSessionSpaceId = activeSessionProject?.spaceId || "default";
  const isCrossSpaceSessionVisible = !!manager.activeSession && activeSessionSpaceId !== spaceManager.activeSpaceId;
  const previousRenderedSpaceIdRef = useRef(spaceManager.activeSpaceId);
  const [spaceSwitchLayoutCooldown, setSpaceSwitchLayoutCooldown] = useState(false);
  const hasSpaceChangedThisRender = previousRenderedSpaceIdRef.current !== spaceManager.activeSpaceId;

  useLayoutEffect(() => {
    if (!hasSpaceChangedThisRender) return;
    previousRenderedSpaceIdRef.current = spaceManager.activeSpaceId;
    setSpaceSwitchLayoutCooldown(true);
  }, [hasSpaceChangedThisRender, spaceManager.activeSpaceId]);

  useEffect(() => {
    if (!spaceSwitchLayoutCooldown || isSpaceSwitching || isCrossSpaceSessionVisible) {
      return;
    }

    // Use a 150ms timeout instead of 2 rAF frames to ensure the DOM has fully
    // settled (panels mounted/unmounted, flex layout recalculated) before
    // re-enabling Framer Motion layout animations.
    const timer = setTimeout(() => {
      setSpaceSwitchLayoutCooldown(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [isCrossSpaceSessionVisible, isSpaceSwitching, spaceSwitchLayoutCooldown]);

  const getPreviewPaneMetrics = useCallback((previewIndex: number) => {
    const widthPercent = (previewWidthFractions[previewIndex] ?? (1 / previewPaneCount)) * 100;
    const totalHandleWidth = (previewPaneCount - 1) * SPLIT_HANDLE_WIDTH;
    const handleSharePx = totalHandleWidth / previewPaneCount;
    return { widthPercent, handleSharePx };
  }, [previewPaneCount, previewWidthFractions]);
  const shouldAnimateTopRowLayout = !paneResize.isResizing
    && !isResizing
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

  const renderSplitPane = useCallback((
    sessionId: string,
    session: typeof manager.activeSession,
    paneState: typeof manager.primaryPane,
    displayIndex: number,
    isActiveSessionPane: boolean,
    previewIndex: number,
  ) => {
    const drawer = splitView.getDrawerState(sessionId);
    const { widthPercent, handleSharePx } = getPreviewPaneMetrics(previewIndex);
    const paneProject = session
      ? projectManager.projects.find((project) => project.id === session.projectId) ?? null
      : null;
    const paneProjectPath = paneProject
      ? (getStoredProjectGitCwd(paneProject.id) ?? paneProject.path)
      : activeProjectPath;
    const paneProjectRoot = paneProject?.path;
    const selectedPaneAgent = isActiveSessionPane
      ? selectedAgent
      : session?.agentId
        ? agents.find((agent) => agent.id === session.agentId) ?? null
        : session?.engine === "codex"
          ? agents.find((agent) => agent.engine === "codex") ?? null
          : null;
    const handlePaneSend = async (text: string, images?: Parameters<typeof handleSend>[1], displayText?: string) => {
      splitView.setFocusedSession(sessionId);

      if (isActiveSessionPane) {
        await wrappedHandleSend(text, images, displayText);
        return;
      }

      if (!session) {
        return;
      }

      if (!paneState.isConnected) {
        await manager.switchSession(sessionId);
        await manager.send(text, images, displayText);
        return;
      }

      if (session.engine === "acp") {
        await paneState.acp.send(text, images, displayText);
        return;
      }

      if (session.engine === "codex") {
        try {
          const collaborationMode = buildCodexCollabMode(session.planMode, session.model);
          const sent = await paneState.codex.send(text, images, displayText, collaborationMode);
          if (!sent) {
            await manager.switchSession(sessionId);
            await manager.send(text, images, displayText);
          }
        } catch (err) {
          toast.error("Failed to send message", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      const sent = await paneState.claude.send(text, images, displayText);
      if (!sent) {
        await manager.switchSession(sessionId);
        await manager.send(text, images, displayText);
      }
    };
    const handlePaneStop = async () => {
      splitView.setFocusedSession(sessionId);
      if (isActiveSessionPane) {
        await handleStop();
        return;
      }
      await paneState.engine.interrupt();
    };

    return (
      <motion.div
        layout={shouldAnimateTopRowLayout}
        transition={shouldAnimateTopRowLayout
          ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
          : { duration: 0 }}
        ref={(element) => { paneRefs.current[displayIndex] = element; }}
        className={`chat-island island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background ${
          splitView.focusedSessionId === sessionId ? "ring-2 ring-primary/15" : ""
        }`}
        style={{
          width: `calc(${widthPercent}% - ${handleSharePx}px)`,
          minWidth: MIN_CHAT_WIDTH_SPLIT,
          flexShrink: 0,
          "--chat-fade-strength": String(chatFadeStrength),
        } as React.CSSProperties}
        onClick={() => splitView.setFocusedSession(sessionId)}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-[5] ${isIsland ? "h-20" : "h-24"}`}
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
              sidebarOpen={displayIndex === 0 ? sidebar.isOpen : false}
              showSidebarToggle={displayIndex === 0}
              isProcessing={paneState.isProcessing}
              model={paneState.sessionInfo?.model}
              sessionId={paneState.sessionInfo?.sessionId}
              totalCost={paneState.totalCost}
              title={session?.title}
              titleGenerating={session?.titleGenerating}
              planMode={isActiveSessionPane ? settings.planMode : !!session?.planMode}
              permissionMode={paneState.sessionInfo?.permissionMode}
              acpPermissionBehavior={isActiveSessionPane && session?.engine === "acp" ? settings.acpPermissionBehavior : undefined}
              onToggleSidebar={displayIndex === 0 ? sidebar.toggle : () => {}}
              showDevFill={isActiveSessionPane ? devFillEnabled : false}
              onSeedDevExampleConversation={isActiveSessionPane ? manager.seedDevExampleConversation : undefined}
              onSeedDevExampleSpaceData={isActiveSessionPane ? handleSeedDevExampleSpaceData : undefined}
              onClosePane={() => {
                void handleCloseSplitPane(sessionId);
              }}
            />
          </div>
          <ChatView
            spaceId={spaceManager.activeSpaceId}
            messages={paneState.messages}
            isProcessing={paneState.isProcessing}
            showThinking={showThinking}
            autoGroupTools={settings.autoGroupTools}
            avoidGroupingEdits={settings.avoidGroupingEdits}
            autoExpandTools={settings.autoExpandTools}
            expandEditToolCallsByDefault={settings.expandEditToolCallsByDefault}
            showToolIcons={settings.showToolIcons}
            coloredToolIcons={settings.coloredToolIcons}
            extraBottomPadding={!!paneState.pendingPermission}
            sessionId={sessionId}
            onRevert={isActiveSessionPane && manager.isConnected && manager.revertFiles ? handleRevert : undefined}
            onFullRevert={isActiveSessionPane && manager.isConnected && manager.fullRevert ? handleFullRevert : undefined}
            onTopScrollProgress={paneScrollCallbacks[displayIndex]}
            agents={agents}
            selectedAgent={selectedPaneAgent}
            onAgentChange={isActiveSessionPane ? handleAgentChange : undefined}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] transition-opacity duration-200 ${isIsland ? "h-24" : "h-28"}`}
            style={{ opacity: chatFadeStrength, background: bottomFadeBackground }}
          />
          <div data-chat-composer className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
            <BottomComposer
              pendingPermission={paneState.pendingPermission}
              onRespondPermission={paneState.engine.respondPermission}
              onSend={handlePaneSend}
              onClear={isActiveSessionPane ? handleComposerClear : undefined}
              onStop={handlePaneStop}
              isProcessing={paneState.isProcessing}
              queuedCount={isActiveSessionPane ? manager.queuedCount : 0}
              model={session?.model ?? paneState.sessionInfo?.model ?? settings.model}
              claudeEffort={settings.claudeEffort}
              planMode={isActiveSessionPane ? settings.planMode : !!session?.planMode}
              permissionMode={paneState.sessionInfo?.permissionMode ?? settings.permissionMode}
              onModelChange={handleModelChange}
              onClaudeModelEffortChange={handleClaudeModelEffortChange}
              onPlanModeChange={handlePlanModeChange}
              onPermissionModeChange={handlePermissionModeChange}
              projectPath={paneProjectPath}
              contextUsage={paneState.contextUsage}
              isCompacting={paneState.isCompacting}
              onCompact={paneState.engine.compact}
              agents={agents}
              selectedAgent={selectedPaneAgent}
              onAgentChange={isActiveSessionPane ? handleAgentChange : undefined}
              slashCommands={isActiveSessionPane ? manager.slashCommands : paneState.engine.slashCommands}
              acpConfigOptions={isActiveSessionPane ? manager.acpConfigOptions : paneState.acp.configOptions}
              acpConfigOptionsLoading={isActiveSessionPane ? manager.acpConfigOptionsLoading : false}
              onACPConfigChange={isActiveSessionPane ? manager.setACPConfig : paneState.acp.setConfig}
              acpPermissionBehavior={isActiveSessionPane ? settings.acpPermissionBehavior : undefined}
              onAcpPermissionBehaviorChange={isActiveSessionPane ? settings.setAcpPermissionBehavior : undefined}
              supportedModels={
                isActiveSessionPane
                  ? manager.supportedModels
                  : session?.engine === "codex"
                    ? (paneState.codex.codexModels.length > 0 ? paneState.codex.codexModels : manager.supportedModels)
                    : session?.engine === "acp"
                      ? []
                      : paneState.claude.supportedModels.length > 0
                        ? paneState.claude.supportedModels
                        : manager.supportedModels
              }
              codexModelsLoadingMessage={isActiveSessionPane ? manager.codexModelsLoadingMessage : null}
              codexEffort={isActiveSessionPane ? manager.codexEffort : undefined}
              onCodexEffortChange={isActiveSessionPane ? manager.setCodexEffort : undefined}
              codexModelData={isActiveSessionPane ? manager.codexRawModels : undefined}
              grabbedElements={isActiveSessionPane ? grabbedElements : []}
              onRemoveGrabbedElement={handleRemoveGrabbedElement}
              lockedEngine={isActiveSessionPane ? lockedEngine : (session?.engine ?? null)}
              lockedAgentId={isActiveSessionPane ? lockedAgentId : (session?.agentId ?? null)}
              selectedWorktreePath={paneProjectPath}
              onSelectWorktree={isActiveSessionPane ? handleAgentWorktreeChange : undefined}
              isEmptySession={paneState.messages.length === 0}
              isIslandLayout={isIsland}
              controlsReadOnly={!isActiveSessionPane}
            />
          </div>
        </div>
        <PaneToolDrawer
          open={drawer.open}
          activeTab={drawer.activeTab}
          height={drawer.height}
          onToggleTab={(toolId) => splitView.toggleToolTab(sessionId, toolId)}
          onHeightChange={(height) => splitView.setDrawerHeight(sessionId, height)}
          availableContextual={availableContextual}
        >
          {drawer.activeTab === "terminal" && (
            <ToolsPanel
              spaceId={spaceManager.activeSpaceId}
              tabs={activeSpaceTerminals.tabs}
              activeTabId={activeSpaceTerminals.activeTabId}
              terminalsReady={spaceTerminals.isReady}
              onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
              onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
              onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
              onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
              resolvedTheme={resolvedTheme}
            />
          )}
          {drawer.activeTab === "git" && (
            <GitPanel
              cwd={paneProjectRoot}
              collapsedRepos={settings.collapsedRepos}
              onToggleRepoCollapsed={settings.toggleRepoCollapsed}
              selectedWorktreePath={paneProjectPath}
              onSelectWorktreePath={isActiveSessionPane ? handleAgentWorktreeChange : undefined}
              activeEngine={session?.engine}
              activeSessionId={sessionId}
            />
          )}
          {drawer.activeTab === "browser" && (
            <BrowserPanel onElementGrab={isActiveSessionPane ? handleElementGrab : undefined} />
          )}
          {drawer.activeTab === "files" && (
            <FilesPanel
              sessionId={sessionId}
              messages={paneState.messages}
              cwd={paneProjectPath}
              activeEngine={session?.engine}
              onScrollToToolCall={setScrollToMessageId}
              enabled={true}
            />
          )}
          {drawer.activeTab === "project-files" && (
            <ProjectFilesPanel cwd={paneProjectPath} enabled={true} onPreviewFile={handlePreviewFile} />
          )}
          {drawer.activeTab === "mcp" && (
            <McpPanel
              projectId={paneProject?.id ?? null}
              runtimeStatuses={manager.mcpServerStatuses}
              isPreliminary={isActiveSessionPane ? manager.mcpStatusPreliminary : false}
              hasLiveSession={paneState.isConnected}
              onRefreshStatus={manager.refreshMcpStatus}
              onReconnect={manager.reconnectMcpServer}
              onRestartWithServers={manager.restartWithMcpServers}
            />
          )}
        </PaneToolDrawer>
      </motion.div>
    );
  }, [activeProjectPath, activeSpaceTerminalCwd, activeSpaceTerminals.activeTabId, activeSpaceTerminals.tabs, agents, availableContextual, bottomFadeBackground, chatFadeStrength, devFillEnabled, getPreviewPaneMetrics, grabbedElements, handleAgentChange, handleAgentWorktreeChange, handleClaudeModelEffortChange, handleCloseSplitPane, handleComposerClear, handleElementGrab, handleFullRevert, handleModelChange, handlePermissionModeChange, handlePlanModeChange, handleRemoveGrabbedElement, handleRevert, handleSeedDevExampleSpaceData, handleSend, handleStop, isIsland, lockedAgentId, lockedEngine, manager, paneScrollCallbacks, projectManager.projects, resolvedTheme, selectedAgent, settings, shouldAnimateTopRowLayout, showThinking, sidebar.isOpen, sidebar.toggle, spaceManager.activeSpaceId, spaceTerminals, splitView, titlebarSurfaceColor, topFadeBackground, wrappedHandleSend]);

  const { activeTools } = settings;
  const showCodexAuthDialog =
    !!manager.activeSessionId &&
    manager.activeSession?.engine === "codex" &&
    manager.codexAuthRequired;

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
          onDragOver={!isSplitActive ? splitDragDrop.handleDragOver : undefined}
          onDragLeave={!isSplitActive ? splitDragDrop.handleDragLeave : undefined}
          onDrop={!isSplitActive ? splitDragDrop.handleDrop : undefined}
        >

          {/* ══════ SPLIT VIEW RENDERING ══════ */}
          {isSplitActive ? (
            <LayoutGroup id="split-view-layout">
              <div
                ref={splitContainerRef}
                className="flex min-w-0 flex-1"
                onDragEnter={splitDragDrop.handleDragEnter}
                onDragOver={splitDragDrop.handleDragOver}
                onDragLeave={splitDragDrop.handleDragLeave}
                onDrop={splitDragDrop.handleDrop}
              >
                {splitPaneSessionIds.map((sessionId, displayIndex) => {
                const isActiveSessionPane = sessionId === manager.activeSessionId;
                const ghostBeforeThisPane = previewDropPosition !== null && previewDropPosition <= displayIndex;
                const panePreviewIndex = ghostBeforeThisPane ? displayIndex + 1 : displayIndex;
                const dropZonePreviewIndex = previewDropPosition ?? splitPaneSessionIds.length;
                const dropZoneMetrics = getPreviewPaneMetrics(dropZonePreviewIndex);
                const dropZoneStyle = {
                  width: `calc(${dropZoneMetrics.widthPercent}% - ${dropZoneMetrics.handleSharePx}px + ${SPLIT_HANDLE_WIDTH}px)`,
                  minWidth: MIN_CHAT_WIDTH_SPLIT,
                } as React.CSSProperties;

                return (
                  <React.Fragment key={sessionId}>
                    {displayIndex === 0 && splitDragDrop.dragState.isDragging && splitDragDrop.dragState.dropPosition === 0 && (
                      <SplitDropZone
                        active={true}
                        session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                        style={dropZoneStyle}
                      />
                    )}

                    {displayIndex > 0 && (
                      <>
                        {splitDragDrop.dragState.isDragging && splitDragDrop.dragState.dropPosition === displayIndex && (
                          <SplitDropZone
                            active={true}
                            session={manager.sessions.find((session) => session.id === splitDragDrop.dragState.draggedSessionId)}
                            style={dropZoneStyle}
                          />
                        )}
                        <SplitHandle
                          isIsland={isIsland}
                          isResizing={paneResize.isResizing}
                          onResizeStart={(event) => paneResize.handleSplitResizeStart(displayIndex - 1, event)}
                          onDoubleClick={paneResize.handleSplitDoubleClick}
                        />
                      </>
                    )}

                    {isActiveSessionPane ? (
                      renderSplitPane(
                        sessionId,
                        manager.activeSession,
                        manager.primaryPane,
                        displayIndex,
                        true,
                        panePreviewIndex,
                      )
                    ) : (
                      <SplitPaneHost
                        key={sessionId}
                        sessionId={sessionId}
                        acpPermissionBehavior={settings.acpPermissionBehavior}
                        loadBootstrap={manager.loadSplitPaneBootstrap}
                      >
                        {({ session, paneState }) =>
                          renderSplitPane(sessionId, session, paneState, displayIndex, false, panePreviewIndex)
                        }
                      </SplitPaneHost>
                    )}

                    {displayIndex === splitPaneSessionIds.length - 1
                      && splitDragDrop.dragState.isDragging
                      && splitDragDrop.dragState.dropPosition === splitPaneSessionIds.length
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
                  minWidth: minChatWidth,
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
                  model={manager.sessionInfo?.model}
                  sessionId={manager.sessionInfo?.sessionId}
                  totalCost={manager.totalCost}
                  title={manager.activeSession?.title}
                  titleGenerating={manager.activeSession?.titleGenerating}
                  planMode={settings.planMode}
                  permissionMode={manager.sessionInfo?.permissionMode}
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
                  model={settings.model}
                  claudeEffort={settings.claudeEffort}
                  planMode={settings.planMode}
                  permissionMode={manager.sessionInfo?.permissionMode ?? settings.permissionMode}
                  onModelChange={handleModelChange}
                  onClaudeModelEffortChange={handleClaudeModelEffortChange}
                  onPlanModeChange={handlePlanModeChange}
                  onPermissionModeChange={handlePermissionModeChange}
                  projectPath={activeProjectPath}
                  contextUsage={manager.contextUsage}
                  isCompacting={manager.isCompacting}
                  onCompact={manager.compact}
                  agents={agents}
                  selectedAgent={selectedAgent}
                  onAgentChange={handleAgentChange}
                  slashCommands={manager.slashCommands}
                  acpConfigOptions={manager.acpConfigOptions}
                  acpConfigOptionsLoading={manager.acpConfigOptionsLoading}
                  onACPConfigChange={manager.setACPConfig}
                  acpPermissionBehavior={settings.acpPermissionBehavior}
                  onAcpPermissionBehaviorChange={settings.setAcpPermissionBehavior}
                  supportedModels={manager.supportedModels}
                  codexModelsLoadingMessage={manager.codexModelsLoadingMessage}
                  codexEffort={manager.codexEffort}
                  onCodexEffortChange={manager.setCodexEffort}
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
            {/* Resize handle — between chat and right panel */}
            <div
              className="resize-col flat-divider-soft group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
              onMouseDown={handleResizeStart}
            >
              <div
                className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                  isResizing
                    ? "bg-foreground/40"
                    : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>

            {/* Right panel — Tasks / Agents with optional draggable vertical split */}
            <div
              ref={rightPanelRef}
              className="flex shrink-0 flex-col overflow-hidden"
              style={{ width: settings.rightPanelWidth }}
            >
              {(() => {
                const showTodos = hasTodos && activeTools.has("tasks");
                const showAgents = hasAgents && activeTools.has("agents");
                const bothVisible = showTodos && showAgents;

                return (
                  <>
                    {showTodos && (
                      <div
                        className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={
                          bothVisible
                            ? { height: `calc(${settings.rightSplitRatio * 100}% - ${splitGap}px)`, flexShrink: 0 }
                            : { flex: "1 1 0%", minHeight: 0 }
                        }
                      >
                        <TodoPanel todos={activeTodos} />
                      </div>
                    )}
                    {bothVisible && (
                      <div
                        className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                        style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                        onMouseDown={handleRightSplitStart}
                      >
                        <div
                          className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                            isResizing
                              ? "bg-foreground/40"
                              : "bg-transparent group-hover:bg-foreground/25"
                          }`}
                        />
                      </div>
                    )}
                    {showAgents && (
                      <div
                        className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={
                          bothVisible
                            ? { height: `calc(${(1 - settings.rightSplitRatio) * 100}% - ${splitGap}px)`, flexShrink: 0 }
                            : { flex: "1 1 0%", minHeight: 0 }
                        }
                      >
                        <BackgroundAgentsPanel
                          agents={bgAgents.agents}
                          expandEditToolCallsByDefault={settings.expandEditToolCallsByDefault}
                          onDismiss={bgAgents.dismissAgent}
                          onStopAgent={bgAgents.stopAgent}
                        />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            </motion.div>
          )}

          {/* Tools panels — always mounted when session active to preserve terminal/browser state.
            Each tool is mounted in exactly one location (side column or bottom row) based on bottomTools.
            Hidden (display: none) when inactive, keeping processes alive. */}
          {manager.activeSessionId && (() => {
            // Shared tool component map — each tool rendered once
            const toolComponents: Record<string, React.ReactNode> = {
              terminal: (
                <ToolsPanel
                  spaceId={spaceManager.activeSpaceId}
                  tabs={activeSpaceTerminals.tabs}
                  activeTabId={activeSpaceTerminals.activeTabId}
                  terminalsReady={spaceTerminals.isReady}
                  onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
                  onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                  onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                  onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
                  resolvedTheme={resolvedTheme}
                />
              ),
              git: (
                <GitPanel
                  key={activeSpaceProject?.id ?? "git-panel-empty"}
                  cwd={activeSpaceProject?.path}
                  collapsedRepos={settings.collapsedRepos}
                  onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                  selectedWorktreePath={activeSpaceTerminalCwd}
                  onSelectWorktreePath={handleAgentWorktreeChange}
                  activeEngine={manager.activeSession?.engine}
                  activeSessionId={manager.activeSessionId}
                />
              ),
              browser: <BrowserPanel onElementGrab={handleElementGrab} />,
              files: (
                <FilesPanel
                  sessionId={manager.activeSessionId}
                  messages={manager.messages}
                  cwd={activeProjectPath}
                  activeEngine={manager.activeSession?.engine}
                  onScrollToToolCall={setScrollToMessageId}
                  enabled={activeTools.has("files")}
                />
              ),
              "project-files": (
                <ProjectFilesPanel
                  cwd={activeProjectPath}
                  enabled={activeTools.has("project-files")}
                  onPreviewFile={handlePreviewFile}
                />
              ),
              mcp: (
                <McpPanel
                  projectId={activeProjectId ?? null}
                  runtimeStatuses={manager.mcpServerStatuses}
                  isPreliminary={manager.mcpStatusPreliminary}
                  hasLiveSession={!manager.isDraft}
                  onRefreshStatus={manager.refreshMcpStatus}
                  onReconnect={manager.reconnectMcpServer}
                  onRestartWithServers={manager.restartWithMcpServers}
                />
              ),
            };

            // ── Side column: tools NOT in bottomTools ──
            const sideToolIds = settings.toolOrder.filter((id) => id in toolComponents && !settings.bottomTools.has(id));
            const activeSideIds = sideToolIds.filter((id) => activeTools.has(id));
            const sideCount = activeSideIds.length;
            const sideRatios = normalizeRatios(settings.toolsSplitRatios, sideCount);
            normalizedToolRatiosRef.current = sideRatios;

            return (
              <motion.div
                layout={shouldAnimateTopRowLayout}
                transition={shouldAnimateTopRowLayout
                  ? { type: "spring", stiffness: 380, damping: 34, mass: 0.65 }
                  : { duration: 0 }}
                className={`flex shrink-0 overflow-hidden ${showSinglePaneSplitPreview ? "pointer-events-none opacity-0" : ""}`}
                style={showSinglePaneSplitPreview ? { width: 0, minWidth: 0 } : undefined}
              >
              {/* Resize handle — only visible when side tools column is showing */}
              {hasToolsColumn && (
                <div
                  className="resize-col flat-divider-soft group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                  style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
                  onMouseDown={handleToolsResizeStart}
                >
                  <div
                    className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                      isResizing
                        ? "bg-foreground/40"
                        : "bg-transparent group-hover:bg-foreground/25"
                    }`}
                  />
                </div>
              )}

              <div
                ref={hasToolsColumn ? toolsColumnRef : null}
                className={`flex shrink-0 flex-col gap-0 overflow-hidden ${!hasToolsColumn ? "hidden" : ""}`}
                style={{ width: settings.toolsPanelWidth }}
              >
                {sideToolIds.map((id) => {
                  const isActive = activeTools.has(id);
                  const activeIdx = isActive ? activeSideIds.indexOf(id) : -1;

                  return (
                    <div key={id} className={isActive ? "contents" : "hidden"}>
                      <div
                        className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                        style={isActive ? { flex: `${sideRatios[activeIdx]} 1 0%`, minHeight: 0 } : undefined}
                      >
                        {toolComponents[id]}
                      </div>
                      {isActive && activeIdx < sideCount - 1 && (
                        <div
                          className="resize-row group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                          style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
                          onMouseDown={(e) => handleToolsSplitStart(e, activeIdx)}
                        >
                          <div
                            className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                              isResizing
                                ? "bg-foreground/40"
                                : "bg-transparent group-hover:bg-foreground/25"
                            }`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </motion.div>
            );
          })()}

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
                activeTools={activeTools}
                onToggle={handleToggleTool}
                availableContextual={availableContextual}
                toolOrder={settings.toolOrder}
                onReorder={handleToolReorder}
                projectPath={activeProjectPath}
                bottomTools={settings.bottomTools}
                onMoveToBottom={settings.moveToolToBottom}
                onMoveToSide={settings.moveToolToSide}
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

        {/* ── Bottom tools row — tools placed in the bottom row via right-click menu (hidden in split view) ── */}
        {!isSplitActive && manager.activeSessionId && (() => {
          // Build tool components for bottom-placed tools only.
          // Note: moving a tool between side↔bottom is an explicit user action,
          // so the unmount/remount is acceptable.
          const bottomToolComponents: Record<string, React.ReactNode> = {
            terminal: (
              <ToolsPanel
                spaceId={spaceManager.activeSpaceId}
                tabs={activeSpaceTerminals.tabs}
                activeTabId={activeSpaceTerminals.activeTabId}
                terminalsReady={spaceTerminals.isReady}
                onSetActiveTab={(tabId) => spaceTerminals.setActiveTab(spaceManager.activeSpaceId, tabId)}
                onCreateTerminal={() => spaceTerminals.createTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                onEnsureTerminal={() => spaceTerminals.ensureTerminal(spaceManager.activeSpaceId, activeSpaceTerminalCwd ?? undefined)}
                onCloseTerminal={(tabId) => spaceTerminals.closeTerminal(spaceManager.activeSpaceId, tabId)}
                resolvedTheme={resolvedTheme}
              />
            ),
            git: (
              <GitPanel
                key={activeSpaceProject?.id ?? "git-panel-empty"}
                cwd={activeSpaceProject?.path}
                collapsedRepos={settings.collapsedRepos}
                onToggleRepoCollapsed={settings.toggleRepoCollapsed}
                selectedWorktreePath={activeSpaceTerminalCwd}
                onSelectWorktreePath={handleAgentWorktreeChange}
                activeEngine={manager.activeSession?.engine}
                activeSessionId={manager.activeSessionId}
              />
            ),
            browser: <BrowserPanel onElementGrab={handleElementGrab} />,
            files: (
              <FilesPanel
                sessionId={manager.activeSessionId}
                messages={manager.messages}
                cwd={activeProjectPath}
                activeEngine={manager.activeSession?.engine}
                onScrollToToolCall={setScrollToMessageId}
                enabled={activeTools.has("files")}
              />
            ),
            "project-files": (
              <ProjectFilesPanel
                cwd={activeProjectPath}
                enabled={activeTools.has("project-files")}
                onPreviewFile={handlePreviewFile}
              />
            ),
            mcp: (
              <McpPanel
                projectId={activeProjectId ?? null}
                runtimeStatuses={manager.mcpServerStatuses}
                isPreliminary={manager.mcpStatusPreliminary}
                hasLiveSession={!manager.isDraft}
                onRefreshStatus={manager.refreshMcpStatus}
                onReconnect={manager.reconnectMcpServer}
                onRestartWithServers={manager.restartWithMcpServers}
              />
            ),
          };

          // All bottom-placed tool IDs (in display order) — mount ALL, hide inactive
          const allBottomToolIds = settings.toolOrder.filter((id) => id in bottomToolComponents && settings.bottomTools.has(id));
          const activeBottomIds = allBottomToolIds.filter((id) => activeTools.has(id));
          const bottomCount = activeBottomIds.length;
          const bottomRatios = normalizeRatios(settings.bottomToolsSplitRatios, bottomCount);
          normalizedBottomRatiosRef.current = bottomRatios;

          // Always mount the bottom row when there are bottom-placed tools,
          // hidden when none are active — preserves terminal/browser state.
          const anyBottomPlaced = allBottomToolIds.length > 0;
          if (!anyBottomPlaced) return null;

          return (
            <>
            {/* Resize handle — between top area and bottom tools row */}
            <div
              className={`resize-row flat-divider-soft group flex h-2 shrink-0 cursor-row-resize items-center justify-center ${!hasBottomTools ? "hidden" : ""}`}
              style={isIsland ? { height: "var(--island-panel-gap)" } : undefined}
              onMouseDown={handleBottomResizeStart}
            >
              <div
                className={`w-10 h-0.5 rounded-full transition-colors duration-150 ${
                  isResizing
                    ? "bg-foreground/40"
                    : "bg-transparent group-hover:bg-foreground/25"
                }`}
              />
            </div>

            <div
              ref={hasBottomTools ? bottomToolsRowRef : null}
              className={`flex shrink-0 overflow-hidden ${!hasBottomTools ? "hidden" : ""}`}
              style={{ height: settings.bottomToolsHeight }}
            >
              {allBottomToolIds.map((id) => {
                const isActive = activeTools.has(id);
                const activeIdx = isActive ? activeBottomIds.indexOf(id) : -1;

                return (
                  <div key={id} className={isActive ? "contents" : "hidden"}>
                    <div
                      className="island flex flex-col overflow-hidden rounded-[var(--island-radius)] bg-background"
                      style={isActive ? { flex: `${bottomRatios[activeIdx]} 1 0%`, minWidth: 0 } : undefined}
                    >
                      {bottomToolComponents[id]}
                    </div>
                    {isActive && activeIdx < bottomCount - 1 && (
                      <div
                        className="resize-col flat-divider-soft group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                        style={isIsland ? { width: "var(--island-panel-gap)" } : undefined}
                        onMouseDown={(e) => handleBottomSplitStart(e, activeIdx)}
                      >
                        <div
                          className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${
                            isResizing
                              ? "bg-foreground/40"
                              : "bg-transparent group-hover:bg-foreground/25"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          );
        })()}
        </div>{/* end showSettings wrapper */}
      </div>
      {showCodexAuthDialog && (
        <CodexAuthDialog
          sessionId={manager.activeSessionId!}
          onComplete={() => manager.clearCodexAuthRequired()}
          onCancel={() => manager.clearCodexAuthRequired()}
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
