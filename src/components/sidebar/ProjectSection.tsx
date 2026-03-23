import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Pencil,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  FolderPlus,
  SquarePen,
  KanbanSquare,
  ChevronRight,
  ChevronDown,
  History,
  ArrowRightLeft,
  Smile,
  X,
  GitBranch,
} from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { IconPicker } from "@/components/IconPicker";
import type { ChatFolder, ChatSession, InstalledAgent, Project, Space } from "@/types";
import { SessionItem } from "./SessionItem";
import { CCSessionList } from "./CCSessionList";
import { PinnedSection } from "./PinnedSection";
import { FolderSection } from "./FolderSection";
import { BranchSection } from "./BranchSection";
import { buildSidebarGroups, type SidebarItem } from "@/lib/sidebar-grouping";

export function ProjectSection({
  islandLayout,
  project,
  sessions,
  folders,
  activeSessionId,
  jiraBoardEnabled,
  isJiraBoardOpen,
  organizeByChatBranch,
  onNewChat,
  onToggleJiraBoard,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onDeleteProject,
  onRenameProject,
  onUpdateIcon,
  onImportCCSession,
  otherSpaces,
  onMoveToSpace,
  onReorderProject,
  defaultChatLimit,
  onPinSession,
  onMoveSessionToFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onPinFolder,
  onSetOrganizeByChatBranch,
  agents,
  onOpenInSplitView,
  canOpenSessionInSplitView,
}: {
  islandLayout: boolean;
  project: Project;
  sessions: ChatSession[];
  folders: ChatFolder[];
  activeSessionId: string | null;
  jiraBoardEnabled: boolean;
  isJiraBoardOpen: boolean;
  organizeByChatBranch: boolean;
  onNewChat: () => void;
  onToggleJiraBoard: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteProject: () => void;
  onRenameProject: (name: string) => void;
  onUpdateIcon: (icon: string | null, iconType: "emoji" | "lucide" | null) => void;
  onImportCCSession: (ccSessionId: string) => void;
  otherSpaces: Space[];
  onMoveToSpace: (spaceId: string) => void;
  onReorderProject: (targetProjectId: string) => void;
  defaultChatLimit: number;
  onPinSession: (sessionId: string, pinned: boolean) => void;
  onMoveSessionToFolder: (sessionId: string, folderId: string | null) => void;
  onCreateFolder: () => void;
  onRenameFolder: (projectId: string, folderId: string, name: string) => void;
  onDeleteFolder: (projectId: string, folderId: string) => void;
  onPinFolder: (projectId: string, folderId: string, pinned: boolean) => void;
  onSetOrganizeByChatBranch: (on: boolean) => void;
  agents?: InstalledAgent[];
  onOpenInSplitView?: (sessionId: string) => void;
  canOpenSessionInSplitView?: (sessionId: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAlign, setMenuAlign] = useState<"start" | "end">("end");
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const openingIconPickerRef = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);
  // Pagination: show N items initially, load 20 more on each click
  const [visibleCount, setVisibleCount] = useState(defaultChatLimit);

  // Reset visible count when the configured limit changes
  useEffect(() => {
    setVisibleCount(defaultChatLimit);
  }, [defaultChatLimit]);

  // Build grouped sidebar items using the grouping algorithm
  const sidebarItems = useMemo(
    () => buildSidebarGroups(sessions, folders, organizeByChatBranch),
    [sessions, folders, organizeByChatBranch],
  );

  // Count non-pinned items for pagination
  const pinnedItem = sidebarItems.find((item) => item.type === "pinned");
  const contentItems = sidebarItems.filter((item) => item.type !== "pinned");

  // For pagination, count total visible sessions (not groups)
  const totalSessionCount = sessions.filter((s) => !s.pinned).length;
  const hasMore = totalSessionCount > visibleCount;
  const remainingCount = totalSessionCount - visibleCount;

  // Limit content items to visibleCount sessions
  const visibleContentItems = useMemo(() => {
    let sessionsSoFar = 0;
    const visible: SidebarItem[] = [];
    for (const item of contentItems) {
      if (sessionsSoFar >= visibleCount) break;
      visible.push(item);
      if (item.type === "session") {
        sessionsSoFar += 1;
      } else {
        sessionsSoFar += item.sessions.length;
      }
    }
    return visible;
  }, [contentItems, visibleCount]);

  const handleRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      onRenameProject(trimmed);
    }
    setIsEditing(false);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const headerRect = headerRef.current?.getBoundingClientRect();
    setMenuPos({
      x: headerRect ? e.clientX - headerRect.left : 0,
      y: headerRect ? e.clientY - headerRect.top : 0,
    });
    setMenuAlign("start");
    setMenuOpen(true);
  }, []);

  const handleMenuButtonClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const headerRect = headerRef.current?.getBoundingClientRect();
    const buttonRect = e.currentTarget.getBoundingClientRect();
    setMenuPos({
      x: headerRect ? buttonRect.right - headerRect.left : 0,
      y: headerRect ? buttonRect.bottom - headerRect.top : 0,
    });
    setMenuAlign("end");
    setMenuOpen(true);
  }, []);

  if (isEditing) {
    return (
      <div className="mb-1 flex items-center gap-1 px-1 ps-2">
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setIsEditing(false);
          }}
          className="flex-1 rounded-lg bg-black/5 px-2 py-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-sidebar-ring dark:bg-white/5"
        />
      </div>
    );
  }

  /** Render a single sidebar item (folder, branch, or session). */
  function renderItem(item: SidebarItem) {
    if (item.type === "folder" && item.folder) {
      return (
        <FolderSection
          key={`folder-${item.folder.id}`}
          folder={item.folder}
          sessions={item.sessions}
          activeSessionId={activeSessionId}
          islandLayout={islandLayout}
          allFolders={folders}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onPinSession={onPinSession}
          onMoveSessionToFolder={onMoveSessionToFolder}
          onPinFolder={(pinned) => onPinFolder(project.id, item.folder!.id, pinned)}
          onRenameFolder={(name) => onRenameFolder(project.id, item.folder!.id, name)}
          onDeleteFolder={() => onDeleteFolder(project.id, item.folder!.id)}
          agents={agents}
          onOpenInSplitView={onOpenInSplitView}
          canOpenSessionInSplitView={canOpenSessionInSplitView}
        />
      );
    }

    if (item.type === "branch" && item.children) {
      return (
        <BranchSection
          key={`branch-${item.branchName}`}
          branchName={item.branchName!}
          children={item.children}
          activeSessionId={activeSessionId}
          islandLayout={islandLayout}
          allFolders={folders}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onPinSession={onPinSession}
          onMoveSessionToFolder={onMoveSessionToFolder}
          onPinFolder={onPinFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          agents={agents}
          onOpenInSplitView={onOpenInSplitView}
          canOpenSessionInSplitView={canOpenSessionInSplitView}
        />
      );
    }

    if (item.type === "session" && item.session) {
      return (
        <SessionItem
          key={item.session.id}
          islandLayout={islandLayout}
          session={item.session}
          isActive={item.session.id === activeSessionId}
          onSelect={() => onSelectSession(item.session!.id)}
          onDelete={() => onDeleteSession(item.session!.id)}
          onRename={(title) => onRenameSession(item.session!.id, title)}
          onPinToggle={() => onPinSession(item.session!.id, !item.session!.pinned)}
          folders={folders}
          onMoveToFolder={(folderId) => onMoveSessionToFolder(item.session!.id, folderId)}
          agents={agents}
          onOpenInSplitView={onOpenInSplitView ? () => onOpenInSplitView(item.session!.id) : undefined}
          canOpenInSplitView={canOpenSessionInSplitView?.(item.session!.id) ?? true}
        />
      );
    }

    return null;
  }

  return (
    <div
      className={`mb-2 rounded-xl transition-all ${isDragOver ? "bg-black/5 ring-1 ring-primary/20 dark:bg-white/5" : ""}`}
      onDragOver={(e) => {
        // Accept project drops for reorder
        if (e.dataTransfer.types.includes("application/x-project-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false);
        const draggedId = e.dataTransfer.getData("application/x-project-id");
        if (draggedId && draggedId !== project.id) {
          onReorderProject(draggedId);
        }
      }}
    >
      {/* Project header row */}
      <div
        ref={headerRef}
        className="group relative flex items-center"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-project-id", project.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 group-hover:pe-20 py-2 text-start text-[13px] font-semibold text-sidebar-foreground/90 transition-all hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-sidebar-foreground/50 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          {project.icon && project.iconType === "emoji" ? (
            <span className="h-4 w-4 shrink-0 text-center text-sm leading-4">{project.icon}</span>
          ) : project.icon && project.iconType === "lucide" ? (
            (() => {
              const Icon = resolveLucideIcon(project.icon);
              return Icon ? (
                <Icon className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
              ) : (
                <FolderOpen className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
              );
            })()
          ) : (
            <FolderOpen className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
          )}
          <span className="min-w-0 truncate">{project.name}</span>
        </button>

        <div className="absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {jiraBoardEnabled && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 shrink-0 rounded-lg transition-all ${
                isJiraBoardOpen
                  ? "bg-black/10 text-sidebar-foreground dark:bg-white/15"
                  : "text-sidebar-foreground/50 hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
              }`}
              onClick={onToggleJiraBoard}
              title="Open Jira board"
            >
              <KanbanSquare className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-lg text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
            onClick={onNewChat}
          >
            <SquarePen className="h-4 w-4" />
          </Button>

          <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
            <PopoverAnchor asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-lg text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
                onClick={handleMenuButtonClick}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverAnchor>

          {/* Icon picker popover — anchored to the ... button, triggered from dropdown "Set icon" */}
          <PopoverContent align="start" side="right" className="w-72 p-3">
            <IconPicker
              value={project.icon ?? ""}
              iconType={project.iconType ?? "emoji"}
              onChange={(icon, type) => {
                onUpdateIcon(icon, type);
                setIconPickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        </div>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <span
              style={{
                position: "absolute",
                left: menuPos.x,
                top: menuPos.y,
                width: 0,
                height: 0,
                pointerEvents: "none",
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={menuAlign}
            side="bottom"
            sideOffset={6}
            className="w-48"
            onCloseAutoFocus={(e) => {
              if (!openingIconPickerRef.current) return;
              e.preventDefault();
              openingIconPickerRef.current = false;
            }}
          >
            <DropdownMenuItem onClick={onCreateFolder}>
              <FolderPlus className="me-2 h-3.5 w-3.5" />
              New folder
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={organizeByChatBranch}
              onCheckedChange={onSetOrganizeByChatBranch}
            >
              <GitBranch className="me-2 h-3.5 w-3.5" />
              Organize by branch
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setEditName(project.name);
                setIsEditing(true);
              }}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                openingIconPickerRef.current = true;
                setMenuOpen(false);
                requestAnimationFrame(() => setIconPickerOpen(true));
              }}
            >
              <Smile className="me-2 h-3.5 w-3.5" />
              Set icon
            </DropdownMenuItem>
            {project.icon && (
              <DropdownMenuItem onClick={() => onUpdateIcon(null, null)}>
                <X className="me-2 h-3.5 w-3.5" />
                Remove icon
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <History className="me-2 h-3.5 w-3.5" />
                Resume CC Chat
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
                <CCSessionList projectPath={project.path} onSelect={onImportCCSession} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {otherSpaces.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft className="me-2 h-3.5 w-3.5" />
                  Move to space
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {otherSpaces.map((s) => {
                    const SpIcon = s.iconType === "lucide" ? resolveLucideIcon(s.icon) : null;
                    return (
                      <DropdownMenuItem key={s.id} onClick={() => onMoveToSpace(s.id)}>
                        {s.iconType === "emoji" ? (
                          <span className="me-2 text-sm">{s.icon}</span>
                        ) : SpIcon ? (
                          <SpIcon className="me-2 h-3.5 w-3.5" />
                        ) : null}
                        {s.name}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDeleteProject}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nested chats */}
      {expanded && (
        <div className="ms-2 overflow-hidden">
          {/* Pinned section */}
          {pinnedItem && (
            <PinnedSection
              sessions={pinnedItem.sessions}
              pinnedFolders={pinnedItem.children}
              activeSessionId={activeSessionId}
              islandLayout={islandLayout}
              folders={folders}
              onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession}
              onRenameSession={onRenameSession}
              onPinSession={onPinSession}
              onMoveSessionToFolder={onMoveSessionToFolder}
              onPinFolder={onPinFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              agents={agents}
              onOpenInSplitView={onOpenInSplitView}
              canOpenSessionInSplitView={canOpenSessionInSplitView}
            />
          )}

          {/* Content items (folders, branches, ungrouped sessions) */}
          {visibleContentItems.map((item) => renderItem(item))}

          {/* Load more button */}
          {hasMore && (
            <button
              onClick={() => setVisibleCount((prev) => prev + 20)}
              className="group/more mt-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground/70 dark:hover:bg-white/5"
            >
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-hover/more:translate-y-0.5" />
              <span>
                Show more
                <span className="ms-1 text-sidebar-foreground/35">
                  ({Math.min(20, remainingCount)} of {remainingCount})
                </span>
              </span>
            </button>
          )}

          {sessions.length === 0 && (
            <p className="px-3 py-2 text-[13px] font-medium text-sidebar-foreground/40">
              No conversations yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
