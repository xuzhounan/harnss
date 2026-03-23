import { useState, useCallback, useRef } from "react";
import { Folder, ChevronRight, Pencil, Trash2, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatFolder, ChatSession, InstalledAgent } from "@/types";
import { SessionItem } from "./SessionItem";
import {
  isSidebarDragKind,
  handleSidebarFolderDrop,
} from "@/lib/sidebar-dnd";

export function FolderSection({
  folder,
  sessions,
  activeSessionId,
  islandLayout,
  allFolders,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  onMoveSessionToFolder,
  onPinFolder,
  onRenameFolder,
  onDeleteFolder,
  agents,
  defaultCollapsed = false,
  onOpenInSplitView,
  canOpenSessionInSplitView,
}: {
  folder: ChatFolder;
  sessions: ChatSession[];
  activeSessionId: string | null;
  islandLayout: boolean;
  allFolders: ChatFolder[];
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
  onMoveSessionToFolder: (sessionId: string, folderId: string | null) => void;
  onPinFolder: (pinned: boolean) => void;
  onRenameFolder: (name: string) => void;
  onDeleteFolder: () => void;
  agents?: InstalledAgent[];
  defaultCollapsed?: boolean;
  onOpenInSplitView?: (sessionId: string) => void;
  canOpenSessionInSplitView?: (sessionId: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAlign, setMenuAlign] = useState<"start" | "end">("end");
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const rowRef = useRef<HTMLDivElement>(null);

  const handleRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== folder.name) {
      onRenameFolder(trimmed);
    }
    setIsEditing(false);
  }, [editName, folder.name, onRenameFolder]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isSidebarDragKind("session", e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      handleSidebarFolderDrop(e, folder.id, {
        onMoveSessionToFolder: (sessionId, folderId) => {
          onMoveSessionToFolder(sessionId, folderId);
        },
        onReorderFolder: () => {
          // folder reorder not implemented yet
        },
      });
    },
    [folder.id, onMoveSessionToFolder],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rowRect = rowRef.current?.getBoundingClientRect();
    setMenuPos({
      x: rowRect ? e.clientX - rowRect.left : 0,
      y: rowRect ? e.clientY - rowRect.top : 0,
    });
    setMenuAlign("start");
    setMenuOpen(true);
  }, []);

  const handleMenuButtonClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const rowRect = rowRef.current?.getBoundingClientRect();
    const buttonRect = e.currentTarget.getBoundingClientRect();
    setMenuPos({
      x: rowRect ? buttonRect.right - rowRect.left : 0,
      y: rowRect ? buttonRect.bottom - rowRect.top : 0,
    });
    setMenuAlign("end");
    setMenuOpen(true);
  }, []);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1 ps-4">
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

  return (
    <div
      className={`rounded-lg transition-all ${
        isDragOver
          ? "bg-primary/5 ring-1 ring-primary/20 dark:bg-primary/10"
          : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Folder header */}
      <div
        ref={rowRef}
        className="group relative flex items-center"
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-3 group-hover:pe-8 py-1.5 text-start text-[12px] font-semibold text-sidebar-foreground/60 transition-all hover:bg-black/5 hover:text-sidebar-foreground/80 dark:hover:bg-white/5"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-sidebar-foreground/40 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <Folder className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
          <span className="min-w-0 truncate">{folder.name}</span>
          <span className="ms-auto shrink-0 text-[10px] font-normal text-sidebar-foreground/30">
            {sessions.length}
          </span>
        </button>

        <div className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-sidebar-foreground/50 hover:bg-black/10 hover:text-sidebar-foreground dark:hover:bg-white/10"
            onClick={handleMenuButtonClick}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
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
          <DropdownMenuContent align={menuAlign} side="bottom" sideOffset={6} className="w-36">
            <DropdownMenuItem onClick={() => onPinFolder(!folder.pinned)}>
              {folder.pinned ? (
                <>
                  <PinOff className="me-2 h-3.5 w-3.5" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="me-2 h-3.5 w-3.5" />
                  Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setEditName(folder.name);
                setIsEditing(true);
              }}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDeleteFolder}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Folder contents */}
      {expanded && (
        <div className="ms-2">
          {sessions.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-sidebar-foreground/30 italic">
              No chats
            </p>
          ) : (
            sessions.map((session) => (
              <SessionItem
                key={session.id}
                islandLayout={islandLayout}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => onSelectSession(session.id)}
                onDelete={() => onDeleteSession(session.id)}
                onRename={(title) => onRenameSession(session.id, title)}
                onPinToggle={() => onPinSession(session.id, !session.pinned)}
                folders={allFolders}
                onMoveToFolder={(folderId) => onMoveSessionToFolder(session.id, folderId)}
                agents={agents}
                onOpenInSplitView={onOpenInSplitView ? () => onOpenInSplitView(session.id) : undefined}
                canOpenInSplitView={canOpenSessionInSplitView?.(session.id) ?? true}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
