/**
 * Wraps `usePaneResize` with the chat-fraction coordinate transform
 * needed by the main workspace tool column resize.
 *
 * In single-chat mode, width fractions are [chatFraction, ...toolFractions].
 * `usePaneResize` operates in tool-relative space (fractions normalized to sum=1
 * within the tool area only). This hook converts between the two coordinate systems
 * so the resize operates smoothly without corrupting the chat fraction.
 */

import { useRef } from "react";
import { usePaneResize } from "@/hooks/usePaneResize";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";

export function useMainToolPaneResize(
  workspace: MainToolWorkspaceState,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  // Ref for stable chat fraction access during drag (avoids stale closure in mousemove handler)
  const chatFractionRef = useRef(workspace.widthFractions[0] ?? 1);
  chatFractionRef.current = workspace.widthFractions[0] ?? 1;

  return usePaneResize({
    widthFractions: (() => {
      const chatFraction = workspace.widthFractions[0] ?? 1;
      const toolFractions = workspace.widthFractions.slice(1);
      const totalToolFraction = Math.max(1 - chatFraction, 0.0001);
      return toolFractions.length > 0
        ? toolFractions.map((fraction) => fraction / totalToolFraction)
        : [];
    })(),
    setWidthFractions: (fractions) => {
      const chatFraction = chatFractionRef.current;
      const totalToolFraction = Math.max(1 - chatFraction, 0);
      // Scale tool fractions back to workspace space, preserving chat fraction exactly.
      // Use setWidthFractionsDirect to bypass double clamping — usePaneResize already
      // clamped in the tool-relative coordinate system.
      workspace.setWidthFractionsDirect([
        chatFraction,
        ...fractions.map((fraction) => fraction * totalToolFraction),
      ]);
    },
    containerRef,
  });
}
