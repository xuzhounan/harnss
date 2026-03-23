import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSidebar } from "@/hooks/useSidebar";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { useSpaceTerminals } from "@/hooks/useSpaceTerminals";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { useAcpAgentAutoUpdate } from "@/hooks/useAcpAgentAutoUpdate";
import { useNotifications } from "@/hooks/useNotifications";
import { useSplitView } from "@/hooks/useSplitView";
import {
  APP_SIDEBAR_WIDTH,
} from "@/lib/layout-constants";
import { getAppMinimumWidth } from "@/lib/split-layout";
import { resolveModelValue } from "@/lib/model-utils";
import { getStoredProjectGitCwd, resolveProjectForSpace } from "@/lib/space-projects";
import { getTodoItems } from "@/lib/todo-utils";
import { isMac, isWindows } from "@/lib/utils";
import { COLUMN_TOOL_IDS, type ToolId } from "@/components/ToolPicker";
import type { ImageAttachment, Space, SpaceColor, InstalledAgent, AcpPermissionBehavior, ClaudeEffort, EngineId, ChatFolder, MacBackgroundEffect } from "@/types";
import type { NotificationSettings } from "@/types/ui";

export function useAppOrchestrator() {
  const MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID = "mac-background-effect-restart";
  const sidebar = useSidebar();
  const splitView = useSplitView();
  const projectManager = useProjectManager();
  const spaceManager = useSpaceManager();
  const LAST_SESSION_KEY = "harnss-last-session-per-space";
  // Read ACP permission behavior early — it's a global setting (same localStorage key as useSettings)
  // so we can read it before useSettings which depends on manager.activeSession for per-project scoping
  const acpPermissionBehavior = (localStorage.getItem("harnss-acp-permission-behavior") ?? "ask") as AcpPermissionBehavior;
  const manager = useSessionManager(
    projectManager.projects,
    acpPermissionBehavior,
    spaceManager.setActiveSpaceId,
    splitView.visibleSessionIds,
  );

  // Derive activeProjectId early so useSettings can scope per-project
  const activeProjectId = manager.activeSession?.projectId ?? manager.draftProjectId;
  const readLastSessionMap = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [LAST_SESSION_KEY]);
  const activeSpaceProject = useMemo(
    () => resolveProjectForSpace({
      spaceId: spaceManager.activeSpaceId,
      activeProjectId,
      lastSessionBySpace: readLastSessionMap(),
      projects: projectManager.projects,
      sessions: manager.sessions,
    }),
    [spaceManager.activeSpaceId, activeProjectId, readLastSessionMap, projectManager.projects, manager.sessions],
  );
  const settingsProjectId = activeSpaceProject?.id ?? activeProjectId ?? null;
  const activeProject = projectManager.projects.find((p) => p.id === activeProjectId);

  const [selectedAgent, setSelectedAgent] = useState<InstalledAgent | null>(null);
  const settingsEngine: EngineId = (!manager.isDraft && manager.activeSession?.engine)
    ? manager.activeSession.engine
    : (selectedAgent?.engine ?? "claude");
  const settings = useSettings(settingsProjectId, settingsEngine);
  const resolvedTheme = useTheme(settings.theme);
  const showThinking = true;
  const activeProjectPath = settings.gitCwd ?? activeProject?.path;
  const { agents, refresh: refreshAgents, saveAgent, deleteAgent } = useAgentRegistry();
  useAcpAgentAutoUpdate({ installedAgents: agents, refreshInstalledAgents: refreshAgents });
  const getClaudeEffortForModel = useCallback((model: string | undefined): ClaudeEffort | undefined => {
    if (!model) return undefined;
    const meta = manager.supportedModels.find((entry) => entry.value === model);
    if (!meta?.supportsEffort) return undefined;
    const levels = meta.supportedEffortLevels ?? [];
    if (levels.includes(settings.claudeEffort)) return settings.claudeEffort;
    if (levels.includes("high")) return "high";
    return levels[0];
  }, [manager.supportedModels, settings.claudeEffort]);

  const handleAgentWorktreeChange = useCallback((nextPath: string | null) => {
    settings.setGitCwd(nextPath);

    // If there's an active non-draft session, open a new chat so the agent
    // starts fresh in the selected worktree (instead of restarting in-place).
    if (manager.activeSessionId && !manager.isDraft && manager.activeSession) {
      const engine = manager.activeSession.engine ?? "claude";
      manager.createSession(manager.activeSession.projectId, {
        model: settings.getModelForEngine(engine) || undefined,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: engine === "claude"
          ? getClaudeEffortForModel(settings.getModelForEngine("claude") || undefined)
          : undefined,
        engine,
        agentId: manager.activeSession.agentId,
      });
    }
  }, [manager.activeSessionId, manager.isDraft, manager.activeSession, manager.createSession, settings]);

  const handleAgentChange = useCallback((agent: InstalledAgent | null) => {
    setSelectedAgent(agent);

    // If this agent would open a new chat, do it immediately on selection
    const currentEngine = manager.activeSession?.engine ?? "claude";
    const currentAgentId = manager.activeSession?.agentId;
    const wantedEngine = agent?.engine ?? "claude";
    const wantedAgentId = agent?.id;
    const wantedModel = settings.getModelForEngine(wantedEngine);
    const wantedClaudeEffort = wantedEngine === "claude"
      ? getClaudeEffortForModel(wantedModel || undefined)
      : undefined;
    const needsNewSession = !manager.isDraft && manager.activeSession && (
      currentEngine !== wantedEngine ||
      (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
    );

    if (needsNewSession) {
      manager.createSession(manager.activeSession!.projectId, {
        model: wantedModel || undefined,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: wantedClaudeEffort,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
    } else {
      manager.setDraftAgent(
        wantedEngine,
        agent?.id ?? "claude-code",
        agent?.cachedConfigOptions,
        wantedModel || undefined,
      );
    }
  }, [manager.setDraftAgent, manager.isDraft, manager.activeSession, manager.createSession, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, getClaudeEffortForModel]);

  // Engine is locked once a session is active (not draft) — null means free to switch
  const lockedEngine = !manager.isDraft && manager.activeSession?.engine
    ? manager.activeSession.engine
    : null;

  // Agent ID is locked for ACP sessions — switching agents must open a new chat
  const lockedAgentId = !manager.isDraft && manager.activeSession?.agentId
    ? manager.activeSession.agentId
    : null;

  // Persist ACP config options cache when live session provides them,
  // then refresh agent registry so next agent selection uses cached values
  useEffect(() => {
    const agentId = manager.activeSession?.agentId;
    if (!agentId || manager.activeSession?.engine !== "acp") return;
    if (!manager.acpConfigOptions?.length) return;

    window.claude.agents.updateCachedConfig(agentId, manager.acpConfigOptions)
      .then(() => refreshAgents());
  }, [manager.acpConfigOptions, manager.activeSession, refreshAgents]);

  const [showSettings, setShowSettings] = useState(false);

  // ── Glass/transparency support detection ──
  const [glassSupported, setGlassSupported] = useState(false);
  const [macLiquidGlassSupported, setMacLiquidGlassSupported] = useState<boolean | null>(null);
  const [liveMacBackgroundEffect, setLiveMacBackgroundEffect] = useState<MacBackgroundEffect>(() => {
    const stored = localStorage.getItem("harnss-mac-background-effect");
    if (stored === "liquid-glass" || stored === "vibrancy" || stored === "off") {
      return stored;
    }
    return localStorage.getItem("harnss-transparency") === "false" ? "off" : "liquid-glass";
  });
  useEffect(() => {
    window.claude.getGlassSupported().then((supported) => setGlassSupported(supported));
    window.claude.getMacBackgroundEffectSupport().then((support) => {
      setMacLiquidGlassSupported(!!support.liquidGlass);
    });
  }, []);

  // Keep Electron's native theme in sync so Windows Mica follows the app theme.
  useEffect(() => {
    window.claude.setThemeSource(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    if (!isMac) return;
    const requiresRestart = macLiquidGlassSupported !== false
      && liveMacBackgroundEffect === "liquid-glass"
      && settings.macBackgroundEffect !== "liquid-glass";
    if (requiresRestart) return;

    setLiveMacBackgroundEffect(settings.macBackgroundEffect);
    window.claude.setMacBackgroundEffect(settings.macBackgroundEffect);
  }, [liveMacBackgroundEffect, macLiquidGlassSupported, settings.macBackgroundEffect]);

  useEffect(() => {
    if (!isMac) return;
    const requiresRestart = macLiquidGlassSupported !== false
      && liveMacBackgroundEffect === "liquid-glass"
      && settings.macBackgroundEffect !== "liquid-glass";

    if (!requiresRestart) {
      toast.dismiss(MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID);
      return;
    }

    toast("Restart required", {
      id: MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID,
      duration: Infinity,
      description: "Restart Harnss to switch away from Liquid Glass cleanly.",
      action: {
        label: "Restart",
        onClick: () => {
          void window.claude.relaunchApp();
        },
      },
    });
  }, [liveMacBackgroundEffect, macLiquidGlassSupported, settings.macBackgroundEffect]);

  useEffect(() => {
    if (!isMac || macLiquidGlassSupported !== false) return;
    if (settings.macBackgroundEffect !== "liquid-glass") return;
    settings.setMacBackgroundEffect("vibrancy");
  }, [macLiquidGlassSupported, settings.macBackgroundEffect, settings.setMacBackgroundEffect]);

  // Toggle the glass-enabled CSS class when the transparency setting changes.
  // Preload applies the initial class from localStorage so first paint stays in sync.
  useEffect(() => {
    if (!glassSupported) return;
    const root = document.documentElement;
    const transparencyEnabled = isMac
      ? liveMacBackgroundEffect !== "off"
      : settings.transparency;
    if (transparencyEnabled) {
      root.classList.add("glass-enabled");
    } else {
      root.classList.remove("glass-enabled");
    }
  }, [liveMacBackgroundEffect, settings.transparency, glassSupported]);

  // ── Notification settings (loaded from main-process AppSettings) ──
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [devFillEnabled, setDevFillEnabled] = useState(false);
  const [jiraBoardEnabled, setJiraBoardEnabled] = useState(false);

  // Load on mount + re-fetch when settings panel closes (so changes take effect immediately)
  useEffect(() => {
    window.claude.settings.get().then((s) => {
      if (s?.notifications) setNotificationSettings(s.notifications as NotificationSettings);
      setDevFillEnabled(import.meta.env.DEV && !!s?.showDevFillInChatTitleBar);
      setJiraBoardEnabled(!!s?.showJiraBoard);
    });
  }, [showSettings]);

  // Fire OS notifications and sounds for permission prompts + session completion
  useNotifications({
    pendingPermission: manager.pendingPermission,
    notificationSettings,
    activeSessionId: manager.activeSessionId,
    isProcessing: manager.isProcessing,
  });

  // When settings closes, fire resize so hidden tool panels (xterm) re-fit
  useEffect(() => {
    if (!showSettings) window.dispatchEvent(new Event("resize"));
  }, [showSettings]);

  const [spaceCreatorOpen, setSpaceCreatorOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  // In-chat Ctrl+F / Cmd+F search overlay
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [isSpaceSwitching, setIsSpaceSwitching] = useState(false);
  const spaceTerminals = useSpaceTerminals();

  const hasProjects = projectManager.projects.length > 0;

  // ── Tool toggle with suppression ──

  const handleToggleTool = useCallback(
    (toolId: ToolId) => {
      const isContextual = toolId === "tasks" || toolId === "agents";
      settings.setActiveTools((prev) => {
        const next = new Set(prev);
        if (next.has(toolId)) {
          next.delete(toolId);
          // User manually closed a contextual panel — suppress auto-open
          if (isContextual) settings.suppressPanel(toolId);
        } else {
          next.add(toolId);
          // User manually opened a contextual panel — clear suppression
          if (isContextual) settings.unsuppressPanel(toolId);
        }
        return next;
      });
    },
    [settings],
  );

  // Reorder panel tools in the ToolPicker (moves fromId to toId's position)
  const handleToolReorder = useCallback(
    (fromId: ToolId, toId: ToolId) => {
      const count = settings.toolOrder.filter(
        (id) => settings.activeTools.has(id) && COLUMN_TOOL_IDS.has(id),
      ).length;
      settings.setToolOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(fromId);
        const toIdx = next.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, fromId);
        return next;
      });
      // Reset split ratios to equal when reordering (positional, not keyed)
      if (count > 1) {
        settings.setToolsSplitRatios(new Array<number>(count).fill(1 / count));
        settings.saveToolsSplitRatios();
      }
    },
    [settings],
  );

  const handleNewChat = useCallback(
    async (projectId: string) => {
      setShowSettings(false);
      const agent = selectedAgent;
      const wantedEngine = agent?.engine ?? "claude";
      const wantedModel = settings.getModelForEngine(wantedEngine) || undefined;
      await manager.createSession(projectId, {
        model: wantedModel,
        permissionMode: settings.permissionMode,
        planMode: settings.planMode,
        thinkingEnabled: settings.thinking,
        effort: wantedEngine === "claude" ? getClaudeEffortForModel(wantedModel) : undefined,
        engine: wantedEngine,
        agentId: agent?.id ?? "claude-code",
        cachedConfigOptions: agent?.cachedConfigOptions,
      });
    },
    [manager.createSession, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, getClaudeEffortForModel, selectedAgent],
  );

  const handleSend = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      // If the selected agent/engine differs from the current session, start a new session first
      const currentEngine = manager.activeSession?.engine ?? "claude";
      const wantedEngine = selectedAgent?.engine ?? "claude";
      const currentAgentId = manager.activeSession?.agentId;
      const wantedAgentId = selectedAgent?.id;
      const wantedModel = settings.getModelForEngine(wantedEngine);
      const needsNewSession = !manager.isDraft && manager.activeSession && (
        currentEngine !== wantedEngine ||
        // Switching ACP agents within a session must also create a new chat
        (currentEngine === "acp" && wantedEngine === "acp" && currentAgentId !== wantedAgentId)
      );
      if (needsNewSession) {
        await manager.createSession(manager.activeSession!.projectId, {
          model: wantedModel || undefined,
          permissionMode: settings.permissionMode,
          planMode: settings.planMode,
          thinkingEnabled: settings.thinking,
          effort: wantedEngine === "claude" ? getClaudeEffortForModel(wantedModel || undefined) : undefined,
          engine: wantedEngine,
          agentId: selectedAgent?.id ?? "claude-code",
          cachedConfigOptions: selectedAgent?.cachedConfigOptions,
        });
      }
      await manager.send(text, images, displayText);
    },
    [manager.send, manager.isDraft, manager.activeSession, manager.createSession, selectedAgent, settings.getModelForEngine, settings.permissionMode, settings.planMode, settings.thinking, getClaudeEffortForModel],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      settings.setModel(nextModel);
      manager.setActiveModel(nextModel);
      if (settingsEngine !== "claude") return;
      const nextEffort = getClaudeEffortForModel(nextModel);
      if (!nextEffort || nextEffort === settings.claudeEffort) return;
      settings.setClaudeEffort(nextEffort);
    },
    [settings, settingsEngine, manager.setActiveModel, getClaudeEffortForModel],
  );

  const handlePermissionModeChange = useCallback(
    (nextMode: string) => {
      settings.setPermissionMode(nextMode);
      manager.setActivePermissionMode(nextMode);
    },
    [settings, manager.setActivePermissionMode],
  );

  const handlePlanModeChange = useCallback(
    (enabled: boolean) => {
      settings.setPlanMode(enabled);
      manager.setActivePlanMode(enabled);
    },
    [settings, manager.setActivePlanMode],
  );

  const handleThinkingChange = useCallback(
    (enabled: boolean) => {
      settings.setThinking(enabled);
      manager.setActiveThinking(enabled);
    },
    [settings, manager.setActiveThinking],
  );

  const handleClaudeModelEffortChange = useCallback(
    (model: string, effort: ClaudeEffort) => {
      settings.setModel(model);
      settings.setClaudeEffort(effort);
      manager.setActiveClaudeModelAndEffort(model, effort);
    },
    [settings, manager.setActiveClaudeModelAndEffort],
  );

  const handleStop = useCallback(async () => {
    await manager.interrupt();
  }, [manager.interrupt]);

  const handleSendQueuedNow = useCallback(async (messageId: string) => {
    await manager.sendQueuedMessageNext(messageId);
  }, [manager.sendQueuedMessageNext]);

  const handleUnqueueMessage = useCallback((messageId: string) => {
    manager.unqueueMessage(messageId);
  }, [manager.unqueueMessage]);

  // Wrap session selection to also close settings view
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setShowSettings(false);
      manager.switchSession(sessionId);
    },
    [manager.switchSession],
  );

  // Wrap project creation to also close settings view, assigning to the active space
  const handleCreateProject = useCallback(async () => {
    setShowSettings(false);
    await projectManager.createProject(spaceManager.activeSpaceId);
  }, [projectManager.createProject, spaceManager.activeSpaceId]);

  const handleImportCCSession = useCallback(
    async (projectId: string, ccSessionId: string) => {
      await manager.importCCSession(projectId, ccSessionId);
    },
    [manager.importCCSession],
  );

  const handleSeedDevExampleSpaceData = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const { seedDevExampleSpaceData } = await import("@/lib/dev-seeding/space-seeding");
    await seedDevExampleSpaceData({
      activeSpaceId: spaceManager.activeSpaceId,
      existingProjects: projectManager.projects,
      createDevProject: projectManager.createDevProject,
      saveSession: window.claude.sessions.save,
      refreshSessions: manager.refreshSessions,
    });
  }, [spaceManager.activeSpaceId, projectManager.projects, projectManager.createDevProject, manager.refreshSessions]);

  const handleNavigateToMessage = useCallback(
    (sessionId: string, messageId: string) => {
      manager.switchSession(sessionId);
      setTimeout(() => setScrollToMessageId(messageId), 200);
    },
    [manager.switchSession],
  );

  const handleCreateSpace = useCallback(() => {
    setEditingSpace(null);
    setSpaceCreatorOpen(true);
  }, []);

  const handleEditSpace = useCallback((space: Space) => {
    setEditingSpace(space);
    setSpaceCreatorOpen(true);
  }, []);

  const handleDeleteSpace = useCallback(
    async (id: string) => {
      const deletedId = await spaceManager.deleteSpace(id);
      if (deletedId) {
        await spaceTerminals.destroySpaceTerminals(deletedId);
        for (const p of projectManager.projects) {
          if (p.spaceId === deletedId) {
            await projectManager.updateProjectSpace(p.id, "default");
          }
        }
      }
    },
    [spaceManager.deleteSpace, spaceTerminals, projectManager.projects, projectManager.updateProjectSpace],
  );

  const handleSaveSpace = useCallback(
    async (name: string, icon: string, iconType: "emoji" | "lucide", color: SpaceColor) => {
      if (editingSpace) {
        await spaceManager.updateSpace(editingSpace.id, { name, icon, iconType, color });
      } else {
        await spaceManager.createSpace(name, icon, iconType, color);
      }
    },
    [editingSpace, spaceManager.updateSpace, spaceManager.createSpace],
  );

  const handleMoveProjectToSpace = useCallback(
    async (projectId: string, spaceId: string) => {
      await projectManager.updateProjectSpace(projectId, spaceId);
    },
    [projectManager.updateProjectSpace],
  );

  // ── Space <-> session tracking: switch to last used chat when changing spaces ──

  const prevSpaceIdRef = useRef(spaceManager.activeSpaceId);
  const spaceSwitchRequestIdRef = useRef(0);

  const activeSpaceTerminalCwd = activeSpaceProject
    ? (getStoredProjectGitCwd(activeSpaceProject.id) ?? activeSpaceProject.path)
    : null;

  // Save current session as last-used for its owning space whenever it changes.
  // Use the session's project space (not the currently selected space), because
  // space switching and session switching can be out of sync for one render.
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const active = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!active) return;
    const project = projectManager.projects.find((p) => p.id === active.projectId);
    if (!project) return;
    const sessionSpaceId = project.spaceId || "default";
    const map = readLastSessionMap();
    map[sessionSpaceId] = manager.activeSessionId;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(map));
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, projectManager.projects, readLastSessionMap]);

  // When activeSpaceId changes, switch to last used session in that space.
  // Debounced by 60ms to coalesce rapid space switches and prevent race conditions
  // between concurrent switchSession/createSession calls.
  useEffect(() => {
    const prev = prevSpaceIdRef.current;
    const next = spaceManager.activeSpaceId;
    prevSpaceIdRef.current = next;
    if (prev === next) return;

    const requestId = spaceSwitchRequestIdRef.current + 1;
    spaceSwitchRequestIdRef.current = requestId;
    const finishSpaceSwitch = () => {
      if (spaceSwitchRequestIdRef.current === requestId) {
        setIsSpaceSwitching(false);
      }
    };

    const currentSessionProject = manager.activeSession
      ? projectManager.projects.find((project) => project.id === manager.activeSession?.projectId) ?? null
      : null;
    const currentSessionSpaceId = currentSessionProject?.spaceId || "default";
    const isCurrentSessionAlreadyInNextSpace = !!manager.activeSession && currentSessionSpaceId === next;

    if (!isCurrentSessionAlreadyInNextSpace) {
      setIsSpaceSwitching(true);
      splitView.dismissSplitView();
      void manager.deselectSession();
    } else {
      setIsSpaceSwitching(false);
    }

    const timer = setTimeout(() => {
      // Find projects in the new space
      const spaceProjectIds = new Set(
        projectManager.projects
          .filter((p) => (p.spaceId || "default") === next)
          .map((p) => p.id),
      );

      // Check if current session is already in the new space
      if (manager.activeSession && spaceProjectIds.has(manager.activeSession.projectId)) {
        finishSpaceSwitch();
        return; // Already in the right space
      }

      // Try to restore the last used session in this space
      const map = readLastSessionMap();
      const lastSessionId = map[next];
      if (lastSessionId) {
        const session = manager.sessions.find(
          (s) => s.id === lastSessionId && spaceProjectIds.has(s.projectId),
        );
        if (session) {
          void manager.switchSession(session.id).finally(finishSpaceSwitch);
          return;
        }
      }

      // No remembered chat for this space: open a fresh draft chat in the space.
      // If the space has no projects, we can't create a draft chat yet.
      const firstProjectInSpace = projectManager.projects.find(
        (p) => (p.spaceId || "default") === next,
      );
      if (firstProjectInSpace) {
        void handleNewChat(firstProjectInSpace.id).finally(finishSpaceSwitch);
      } else {
        // No projects in this space — deselect
        void manager.deselectSession().finally(finishSpaceSwitch);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [spaceManager.activeSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync model from loaded session (canonical runtime names -> picker values)
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft || manager.supportedModels.length === 0) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session?.model) return;

    const sessionEngine = session.engine ?? "claude";
    const syncedModel = resolveModelValue(session.model, manager.supportedModels) ?? session.model;
    if (syncedModel !== settings.getModelForEngine(sessionEngine)) {
      settings.setModelForEngine(sessionEngine, syncedModel);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, manager.supportedModels, settings.getModelForEngine, settings.setModelForEngine]);

  // Sync selectedAgent when switching to a different session
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session) return;

    if (session.engine === "acp" && session.agentId) {
      const agent = agents.find((a) => a.id === session.agentId);
      if (agent && selectedAgent?.id !== agent.id) {
        setSelectedAgent(agent);
      }
      return;
    }

    if (session.engine === "codex") {
      const codexAgent = (session.agentId
        ? agents.find((a) => a.id === session.agentId)
        : undefined) ?? agents.find((a) => a.engine === "codex");
      if (codexAgent && selectedAgent?.id !== codexAgent.id) {
        setSelectedAgent(codexAgent);
      }
      return;
    }

    if (selectedAgent !== null) {
      setSelectedAgent(null);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the latest todo list — Codex uses turn/plan/updated events,
  // Claude uses TodoWrite tool calls in the message stream.
  // Optimization: only re-scan when messages.length changes (new message added),
  // not on every streaming content update (which only modifies the last message).
  const todoMsgCount = manager.messages.length;
  const activeTodos = useMemo(() => {
    // Codex engine: todos come from turn/plan/updated events
    if (manager.codexTodoItems && manager.codexTodoItems.length > 0) {
      return manager.codexTodoItems;
    }
    // Claude engine: todos derived from last TodoWrite tool call in messages
    for (let i = manager.messages.length - 1; i >= 0; i--) {
      const msg = manager.messages[i];
      if (
        msg.role === "tool_call" &&
        msg.toolName === "TodoWrite" &&
        msg.toolInput &&
        "todos" in msg.toolInput
      ) {
        return getTodoItems(msg.toolInput.todos);
      }
    }
    return [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoMsgCount, manager.codexTodoItems]);

  const bgAgents = useBackgroundAgents({
    sessionId: manager.activeSessionId,
  });

  // ── Contextual tools (tasks / agents) — auto-activate when data appears ──

  const hasTodos = activeTodos.length > 0;
  const hasAgents = bgAgents.agents.length > 0;

  const availableContextual = useMemo(() => {
    const s = new Set<ToolId>();
    if (hasTodos) s.add("tasks");
    if (hasAgents) s.add("agents");
    return s;
  }, [hasTodos, hasAgents]);

  // Auto-add contextual tools when data appears (unless suppressed)
  useEffect(() => {
    if (!hasTodos) {
      // Data gone — clear suppression so next session starts fresh
      settings.unsuppressPanel("tasks");
      return;
    }
    if (settings.suppressedPanels.has("tasks")) return;
    settings.setActiveTools((prev) => {
      if (prev.has("tasks")) return prev;
      const next = new Set(prev);
      next.add("tasks");
      return next;
    });
  }, [hasTodos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasAgents) {
      settings.unsuppressPanel("agents");
      return;
    }
    if (settings.suppressedPanels.has("agents")) return;
    settings.setActiveTools((prev) => {
      if (prev.has("agents")) return prev;
      const next = new Set(prev);
      next.add("agents");
      return next;
    });
  }, [hasAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shift+Tab — toggle plan mode for Claude and Codex engines
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const engine = manager.activeSession?.engine ?? selectedAgent?.engine ?? "claude";
        if (engine === "acp") return; // ACP doesn't support plan mode
        const next = !settings.planMode;
        settings.setPlanMode(next);
        manager.setActivePlanMode(next);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.planMode, settings.setPlanMode, manager.setActivePlanMode, manager.activeSession?.engine, selectedAgent?.engine]);

  // Cmd+F (Mac) / Ctrl+F — toggle in-chat search overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        if (!manager.activeSessionId) return;
        e.preventDefault();
        setChatSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [manager.activeSessionId]);

  // Close chat search when switching sessions
  useEffect(() => {
    setChatSearchOpen(false);
  }, [manager.activeSessionId]);

  // Sync InputBar controls when sessionInfo.permissionMode changes (e.g. ExitPlanMode)
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const mode = manager.sessionInfo?.permissionMode;
    if (!mode) return;
    const activePlanMode = !!manager.activeSession?.planMode;
    const nextPlanMode = mode === "plan";
    if (settings.planMode !== nextPlanMode) settings.setPlanMode(nextPlanMode);
    if (activePlanMode !== nextPlanMode) {
      manager.setActivePlanMode(nextPlanMode);
    }
  }, [
    manager.activeSessionId,
    manager.activeSession?.planMode,
    manager.isDraft,
    manager.sessionInfo?.permissionMode,
    manager.setActivePlanMode,
    settings.planMode,
    settings.setPlanMode,
  ]);

  // Keep plan toggle scoped to the active chat session.
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft || !manager.activeSession) return;
    const nextPlanMode = !!manager.activeSession.planMode;
    if (settings.planMode !== nextPlanMode) settings.setPlanMode(nextPlanMode);
  }, [manager.activeSessionId, manager.activeSession?.planMode, manager.isDraft, settings.planMode, settings.setPlanMode]);

  // Panel visibility flags
  const hasActiveSessionOrSwitching = !!manager.activeSessionId || isSpaceSwitching;
  const hasRightPanel = ((hasTodos && settings.activeTools.has("tasks")) || (hasAgents && settings.activeTools.has("agents"))) && hasActiveSessionOrSwitching;
  // Side column only includes active COLUMN tools that are NOT placed in the bottom row
  const hasToolsColumn = [...settings.activeTools].some((id) => COLUMN_TOOL_IDS.has(id) && !settings.bottomTools.has(id)) && hasActiveSessionOrSwitching;
  // Bottom tools row: active COLUMN tools that ARE placed in the bottom row
  const hasBottomTools = [...settings.activeTools].some((id) => COLUMN_TOOL_IDS.has(id) && settings.bottomTools.has(id)) && hasActiveSessionOrSwitching;
  const showToolPicker = !!manager.activeSessionId || isSpaceSwitching;

  // ── Dynamic Electron minimum window width ──
  const isSplitViewEnabled = splitView.enabled && splitView.paneCount > 1;

  useEffect(() => {
    const minW = getAppMinimumWidth({
      sidebarOpen: sidebar.isOpen,
      isIslandLayout: settings.islandLayout,
      hasActiveSession: !!manager.activeSessionId,
      hasRightPanel,
      hasToolsColumn,
      isSplitViewEnabled,
      splitPaneCount: splitView.paneCount,
      isWindows,
    });
    window.claude.setMinWidth(Math.max(minW, 600));
  }, [sidebar.isOpen, settings.islandLayout, manager.activeSessionId, hasRightPanel, hasToolsColumn, isSplitViewEnabled, splitView.paneCount]);

  // When tools column or bottom row becomes visible, fire resize so xterm terminals re-fit
  useEffect(() => {
    if (hasToolsColumn || hasBottomTools) window.dispatchEvent(new Event("resize"));
  }, [hasToolsColumn, hasBottomTools]);

  const activeSpaceTerminals = spaceTerminals.getSpaceState(spaceManager.activeSpaceId);

  // ── Sync current git branch to session manager for new session creation ──

  useEffect(() => {
    if (!activeProjectPath) {
      manager.setCurrentBranch(undefined);
      return;
    }
    let cancelled = false;
    window.claude.git.status(activeProjectPath).then((status) => {
      if (!cancelled && status.branch) {
        manager.setCurrentBranch(status.branch);
      }
    }).catch(() => {
      if (!cancelled) manager.setCurrentBranch(undefined);
    });
    return () => { cancelled = true; };
  }, [activeProjectPath, manager.setCurrentBranch]);

  // ── Folder & Pin management ──

  const [foldersByProject, setFoldersByProject] = useState<Record<string, ChatFolder[]>>({});

  // Load folders for all projects on mount and project changes
  useEffect(() => {
    const loadFolders = async () => {
      const result: Record<string, ChatFolder[]> = {};
      for (const project of projectManager.projects) {
        try {
          result[project.id] = await window.claude.folders.list(project.id);
        } catch {
          result[project.id] = [];
        }
      }
      setFoldersByProject(result);
    };
    loadFolders();
  }, [projectManager.projects]);

  const handleCreateFolder = useCallback(async (projectId: string) => {
    const name = "New folder";
    try {
      const folder = await window.claude.folders.create(projectId, name);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: [...(prev[projectId] ?? []), folder],
      }));
    } catch (err) {
      console.error("[handleCreateFolder]", err);
    }
  }, []);

  const handleRenameFolder = useCallback(async (projectId: string, folderId: string, name: string) => {
    try {
      await window.claude.folders.rename(projectId, folderId, name);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).map((f) =>
          f.id === folderId ? { ...f, name } : f,
        ),
      }));
    } catch (err) {
      console.error("[handleRenameFolder]", err);
    }
  }, []);

  const handleDeleteFolder = useCallback(async (projectId: string, folderId: string) => {
    try {
      await window.claude.folders.delete(projectId, folderId);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).filter((f) => f.id !== folderId),
      }));
      // Sessions that were in this folder get their folderId cleared on the backend
      // Update local session state too
      manager.setSessions((prev) =>
        prev.map((s) => (s.folderId === folderId ? { ...s, folderId: undefined } : s)),
      );
    } catch (err) {
      console.error("[handleDeleteFolder]", err);
    }
  }, [manager.setSessions]);

  const handlePinSession = useCallback(async (sessionId: string, pinned: boolean) => {
    // Use setSessions functional form to find + update atomically (avoids stale sessions dep)
    manager.setSessions((prev) => {
      const session = prev.find((s) => s.id === sessionId);
      if (!session) return prev;
      // Fire IPC in the background (don't block the state update)
      window.claude.sessions.updateMeta(session.projectId, sessionId, { pinned: pinned || undefined })
        .catch((err) => console.error("[handlePinSession]", err));
      return prev.map((s) => (s.id === sessionId ? { ...s, pinned: pinned || undefined } : s));
    });
  }, [manager.setSessions]);

  const handlePinFolder = useCallback(async (projectId: string, folderId: string, pinned: boolean) => {
    try {
      await window.claude.folders.pin(projectId, folderId, pinned);
      setFoldersByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).map((f) =>
          f.id === folderId ? { ...f, pinned: pinned || undefined } : f,
        ),
      }));
    } catch (err) {
      console.error("[handlePinFolder]", err);
    }
  }, []);

  const handleMoveSessionToFolder = useCallback(async (sessionId: string, folderId: string | null) => {
    // Use setSessions functional form to find + update atomically
    manager.setSessions((prev) => {
      const session = prev.find((s) => s.id === sessionId);
      if (!session) return prev;
      window.claude.sessions.updateMeta(session.projectId, sessionId, { folderId })
        .catch((err) => console.error("[handleMoveSessionToFolder]", err));
      return prev.map((s) => (s.id === sessionId ? { ...s, folderId: folderId ?? undefined } : s));
    });
  }, [manager.setSessions]);

  return {
    // Core managers
    sidebar,
    splitView,
    projectManager,
    spaceManager,
    manager,
    settings,
    resolvedTheme,

    // Agent state
    agents,
    selectedAgent,
    saveAgent,
    deleteAgent,
    handleAgentChange,
    lockedEngine,
    lockedAgentId,

    // Derived state
    activeProjectId,
    activeProject,
    activeProjectPath,
    activeSpaceProject,
    activeSpaceTerminalCwd,
    showThinking,
    settingsEngine,
    hasProjects,
    isSpaceSwitching,
    showToolPicker,
    hasRightPanel,
    hasToolsColumn,
    hasBottomTools,
    activeTodos,
    bgAgents,
    hasTodos,
    hasAgents,
    availableContextual,
    glassSupported,
    macLiquidGlassSupported: macLiquidGlassSupported ?? false,
    liveMacBackgroundEffect,
    devFillEnabled,
    jiraBoardEnabled,

    // Settings view
    showSettings,
    setShowSettings,

    // Space creator
    spaceCreatorOpen,
    setSpaceCreatorOpen,
    editingSpace,

    // Scroll navigation
    scrollToMessageId,
    setScrollToMessageId,

    // In-chat search
    chatSearchOpen,
    setChatSearchOpen,

    // Terminals
    spaceTerminals,
    activeSpaceTerminals,

    // Callbacks
    handleToggleTool,
    handleToolReorder,
    handleNewChat,
    handleSend,
    handleModelChange,
    handlePermissionModeChange,
    handlePlanModeChange,
    handleThinkingChange,
    handleClaudeModelEffortChange,
    handleAgentWorktreeChange,
    handleStop,
    handleSendQueuedNow,
    handleUnqueueMessage,
    handleSelectSession,
    handleCreateProject,
    handleImportCCSession,
    handleSeedDevExampleSpaceData,
    handleNavigateToMessage,
    handleCreateSpace,
    handleEditSpace,
    handleDeleteSpace,
    handleSaveSpace,
    handleMoveProjectToSpace,

    // Folder & Pin management
    foldersByProject,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handlePinFolder,
    handlePinSession,
    handleMoveSessionToFolder,
  };
}
