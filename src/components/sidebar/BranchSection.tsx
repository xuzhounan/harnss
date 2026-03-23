import { useState } from "react";
import { GitBranch, ChevronRight } from "lucide-react";
import type { ChatFolder, ChatSession, InstalledAgent } from "@/types";
import type { SidebarItem } from "@/lib/sidebar-grouping";
import { FolderSection } from "./FolderSection";
import { SessionItem } from "./SessionItem";

export function BranchSection({
  branchName,
  children,
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
  onOpenInSplitView,
  canOpenSessionInSplitView,
}: {
  branchName: string;
  children: SidebarItem[];
  activeSessionId: string | null;
  islandLayout: boolean;
  allFolders: ChatFolder[];
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
  onMoveSessionToFolder: (sessionId: string, folderId: string | null) => void;
  onPinFolder: (projectId: string, folderId: string, pinned: boolean) => void;
  onRenameFolder: (projectId: string, folderId: string, name: string) => void;
  onDeleteFolder: (projectId: string, folderId: string) => void;
  agents?: InstalledAgent[];
  onOpenInSplitView?: (sessionId: string) => void;
  canOpenSessionInSplitView?: (sessionId: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      {/* Branch header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-start text-[12px] font-semibold text-sidebar-foreground/55 transition-all hover:bg-black/5 hover:text-sidebar-foreground/80 dark:hover:bg-white/5"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-sidebar-foreground/35 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
        <span className="min-w-0 truncate">{branchName}</span>
      </button>

      {/* Branch contents */}
      {expanded && (
        <div className="ms-2">
          {children.map((item) => {
            if (item.type === "folder" && item.folder) {
              return (
                <FolderSection
                  key={`folder-${item.folder.id}`}
                  folder={item.folder}
                  sessions={item.sessions}
                  activeSessionId={activeSessionId}
                  islandLayout={islandLayout}
                  allFolders={allFolders}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  onRenameSession={onRenameSession}
                  onPinSession={onPinSession}
                  onMoveSessionToFolder={onMoveSessionToFolder}
                  onPinFolder={(pinned) => onPinFolder(item.folder!.projectId, item.folder!.id, pinned)}
                  onRenameFolder={(name) => onRenameFolder(item.folder!.projectId, item.folder!.id, name)}
                  onDeleteFolder={() => onDeleteFolder(item.folder!.projectId, item.folder!.id)}
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
                  folders={allFolders}
                  onMoveToFolder={(folderId) => onMoveSessionToFolder(item.session!.id, folderId)}
                  agents={agents}
                  onOpenInSplitView={onOpenInSplitView ? () => onOpenInSplitView(item.session!.id) : undefined}
                  canOpenInSplitView={canOpenSessionInSplitView?.(item.session!.id) ?? true}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
