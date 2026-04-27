import { useCallback, useEffect, useMemo, useState } from "react";
import type { GrabbedElement } from "@/types";
import { WELCOME_COMPLETED_KEY } from "@/components/welcome/shared";

interface UseAppLayoutUIStateInput {
  isNativeGlass: boolean;
  onHideSettings: () => void;
  /**
   * Active session id. Drives the per-session scope of `grabbedElements` —
   * each chat keeps its own browser-grab list so switching session is fully
   * round-trippable.
   */
  activeSessionId: string | null;
}

const GRABBED_STORAGE_KEY = "harnss-grabbed-elements-by-session";
/**
 * Single localStorage blob holding `{ [sessionId]: GrabbedElement[] }`. One
 * blob (vs key-per-session) keeps the read/write small and avoids fragmenting
 * the namespace; the data is small enough that we don't need finer-grained
 * persistence yet.
 */
type GrabbedBySession = Record<string, GrabbedElement[]>;

function readGrabbedFromStorage(): GrabbedBySession {
  try {
    const raw = localStorage.getItem(GRABBED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: GrabbedBySession = {};
    for (const [sessionId, list] of Object.entries(parsed)) {
      if (typeof sessionId === "string" && Array.isArray(list)) {
        // Trust shape only loosely — items will fail to render harmlessly if
        // malformed; full validation lives at the renderer.
        out[sessionId] = list as GrabbedElement[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeGrabbedToStorage(state: GrabbedBySession): void {
  try {
    // Skip persisting empty buckets — keeps the blob from growing forever as
    // sessions get archived/deleted without an explicit purge call.
    const compact: GrabbedBySession = {};
    for (const [sessionId, list] of Object.entries(state)) {
      if (list.length > 0) compact[sessionId] = list;
    }
    if (Object.keys(compact).length === 0) {
      localStorage.removeItem(GRABBED_STORAGE_KEY);
    } else {
      localStorage.setItem(GRABBED_STORAGE_KEY, JSON.stringify(compact));
    }
  } catch { /* quota / private mode — silently drop */ }
}

export function useAppLayoutUIState(input: UseAppLayoutUIStateInput) {
  const [windowFocused, setWindowFocused] = useState(true);
  const [welcomeCompleted, setWelcomeCompleted] = useState(
    () => localStorage.getItem(WELCOME_COMPLETED_KEY) === "true",
  );
  // Per-session grab buckets. Hydrated lazily from localStorage on mount so
  // grabs survive app restart in addition to session/space switches.
  const [grabbedBySession, setGrabbedBySession] = useState<GrabbedBySession>(readGrabbedFromStorage);
  const [previewFile, setPreviewFile] = useState<{ path: string; sourceRect: DOMRect } | null>(null);

  // Persist whenever the bucket map changes — single small blob, no debounce
  // needed for the volumes involved (a few hundred bytes per element max).
  useEffect(() => {
    writeGrabbedToStorage(grabbedBySession);
  }, [grabbedBySession]);

  useEffect(() => {
    if (!input.isNativeGlass) return;
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [input.isNativeGlass]);

  const handleWelcomeComplete = useCallback(() => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, "true");
    setWelcomeCompleted(true);
  }, []);

  const handleReplayWelcome = useCallback(() => {
    localStorage.removeItem(WELCOME_COMPLETED_KEY);
    setWelcomeCompleted(false);
    input.onHideSettings();
  }, [input]);

  // Empty array sentinel — referentially stable so consumers using shallow
  // comparison don't see spurious changes when the active session has no
  // grabs.
  const EMPTY_GRABS = useMemo<GrabbedElement[]>(() => [], []);
  const grabbedElements = input.activeSessionId
    ? (grabbedBySession[input.activeSessionId] ?? EMPTY_GRABS)
    : EMPTY_GRABS;

  const handleElementGrab = useCallback((element: GrabbedElement) => {
    const sid = input.activeSessionId;
    if (!sid) return;
    setGrabbedBySession((prev) => ({
      ...prev,
      [sid]: [...(prev[sid] ?? []), element],
    }));
  }, [input.activeSessionId]);

  const handleRemoveGrabbedElement = useCallback((id: string) => {
    const sid = input.activeSessionId;
    if (!sid) return;
    setGrabbedBySession((prev) => {
      const list = prev[sid];
      if (!list) return prev;
      const next = list.filter((element) => element.id !== id);
      if (next.length === list.length) return prev;
      const updated = { ...prev, [sid]: next };
      if (next.length === 0) delete updated[sid];
      return updated;
    });
  }, [input.activeSessionId]);

  const clearGrabbedElements = useCallback(() => {
    const sid = input.activeSessionId;
    if (!sid) return;
    setGrabbedBySession((prev) => {
      if (!prev[sid]) return prev;
      const updated = { ...prev };
      delete updated[sid];
      return updated;
    });
  }, [input.activeSessionId]);

  const handlePreviewFile = useCallback((filePath: string, sourceRect: DOMRect) => {
    setPreviewFile({ path: filePath, sourceRect });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  return {
    windowFocused,
    welcomeCompleted,
    handleWelcomeComplete,
    handleReplayWelcome,
    grabbedElements,
    clearGrabbedElements,
    handleElementGrab,
    handleRemoveGrabbedElement,
    previewFile,
    handlePreviewFile,
    handleClosePreview,
  };
}
