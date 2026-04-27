import type { Terminal } from "@xterm/xterm";

/**
 * macOS keybindings matching iTerm2's default + common readline shortcuts.
 *
 * Why: xterm.js does not handle macOS-specific Cmd shortcuts and lets the OS
 * eat ⌘← / ⌘→ / ⌘⌫. Setting `macOptionIsMeta: true` would coarsely turn every
 * Option combo into Meta and break native chars like ⌥e → ´. So we install a
 * custom handler that mirrors iTerm2's per-key remaps.
 */
export function applyMacKeybindings(term: Terminal): void {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const cmd = e.metaKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey;

    if (cmd && !alt && !ctrl && !shift) {
      switch (e.key) {
        case "ArrowLeft":
          term.input("\x01");
          return false;
        case "ArrowRight":
          term.input("\x05");
          return false;
        case "Backspace":
          term.input("\x15");
          return false;
      }
    }

    if (alt && !cmd && !ctrl && !shift) {
      switch (e.key) {
        case "ArrowLeft":
          term.input("\x1bb");
          return false;
        case "ArrowRight":
          term.input("\x1bf");
          return false;
        case "Backspace":
          term.input("\x1b\x7f");
          return false;
      }
    }

    if (e.key === "Delete" && !cmd && !ctrl) {
      term.input(alt ? "\x1bd" : "\x04");
      return false;
    }

    if (shift && !cmd && !alt && !ctrl && e.key === "Enter") {
      term.input("\n");
      return false;
    }

    return true;
  });
}
