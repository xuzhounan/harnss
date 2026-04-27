import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ImportSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs the full import flow: look up the Claude Code session by id, resolve
   * or create a Harnss project at the session's cwd, then import + switch to
   * the session. Errors are displayed inline.
   */
  onImport: (sessionId: string) => Promise<{ ok: true; projectId: string } | { error: string }>;
}

export function ImportSessionDialog({ open, onOpenChange, onImport }: ImportSessionDialogProps) {
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSessionId("");
    setBusy(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (busy) return;
    const trimmed = sessionId.trim();
    if (!trimmed) {
      setError("Paste a Claude Code session id first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onImport(trimmed);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import session by ID</DialogTitle>
          <DialogDescription>
            Paste a Claude Code session id. Harnss will scan{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/.claude/projects</code>{" "}
            for the matching session, auto-create a project at its working
            directory if needed, and import the conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            autoFocus
            placeholder="e.g. 019e3f5d-..."
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") void handleSubmit();
            }}
            disabled={busy}
          />
          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || !sessionId.trim()}>
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Importing…
              </span>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
