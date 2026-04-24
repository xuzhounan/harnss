import type { AcpPermissionBehavior } from "@/types";

/** Shared className overrides for ghost toolbar buttons in the input bar.
 *  Applied on top of `<Button variant="ghost" size="xs">` to match the
 *  toolbar look: muted text, subtle hover, rounded-lg corners. */
export const TOOLBAR_BTN =
  "rounded-lg font-normal text-muted-foreground transition-colors duration-150 hover:bg-muted/50 hover:text-foreground";

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type AcceptedMediaType = (typeof ACCEPTED_IMAGE_TYPES)[number];

export const ACP_PERMISSION_BEHAVIORS = [
  {
    id: "ask" as const,
    label: "Ask",
    description: "Show permission prompt",
  },
  {
    id: "auto_accept" as const,
    label: "Auto Accept",
    description: "Auto-approve each tool call",
  },
  {
    id: "allow_all" as const,
    label: "Allow All",
    description: "Auto-approve with always-allow",
  },
] as const satisfies ReadonlyArray<{
  id: AcpPermissionBehavior;
  label: string;
  description: string;
}>;

/**
 * Permission modes exposed in the input-bar dropdown.
 *
 * `auto` uses a model classifier to approve/deny each permission prompt based
 * on risk. This is a Claude Agent SDK feature (`PermissionMode = 'auto'` in
 * `@anthropic-ai/claude-agent-sdk`). Codex has no equivalent — it's filtered
 * out of the dropdown when the active engine is Codex.
 */
export const PERMISSION_MODES = [
  { id: "default", label: "Ask Before Edits", claudeOnly: false },
  { id: "acceptEdits", label: "Accept Edits", claudeOnly: false },
  { id: "auto", label: "Auto (AI-judged)", claudeOnly: true },
  { id: "bypassPermissions", label: "Allow All", claudeOnly: false },
] as const;

export type PermissionModeId = (typeof PERMISSION_MODES)[number]["id"];

export const CODEX_PERMISSION_MODE_DETAILS: Record<
  Exclude<PermissionModeId, "auto">,
  { policy: string; description: string }
> = {
  default: {
    policy: "on-request",
    description: "Prompt before commands and file edits",
  },
  acceptEdits: {
    policy: "untrusted",
    description:
      "Auto-approve trusted edits; prompt for untrusted actions",
  },
  bypassPermissions: {
    policy: "never",
    description: "No approval prompts",
  },
};
