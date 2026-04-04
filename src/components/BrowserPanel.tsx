import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type FormEvent } from "react";
import type { GrabbedElement } from "@/types/ui";
import { getInspectorScript, getCleanupScript, GRAB_MARKER } from "@/lib/element-inspector";
import { capture, reportError } from "@/lib/analytics";

// Electron webview element with navigation methods
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  openDevTools(options?: DevToolsOpenOptions): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}

import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X as XIcon,
  Lock,
  Loader2,
  Crosshair,
  Search,
  ArrowUpRight,
  Bug,
  Sun,
  Moon,
} from "lucide-react";
import { TabBar } from "@/components/TabBar";

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  label: string;
  isLoading: boolean;
  colorScheme: BrowserColorScheme;
  isStartPage?: boolean;
}

interface BrowserHistoryEntry {
  url: string;
  title: string;
}

interface DevToolsOpenOptions {
  mode?: "detach";
  activate?: boolean;
}

type BrowserColorScheme = "light" | "dark";

interface BrowserPanelProps {
  persistKey: string;
  onElementGrab?: (element: GrabbedElement) => void;
  headerControls?: React.ReactNode;
}

const BROWSER_HISTORY_KEY = "harnss-browser-history";
const BROWSER_SESSION_KEY_PREFIX = "harnss-browser-session:";
const MAX_BROWSER_HISTORY = 100;

interface PersistedBrowserSession {
  tabs: BrowserTab[];
  activeTabId: string | null;
}

function getDefaultBrowserColorScheme(): BrowserColorScheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeHistoryUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function normalizeHistoryTitle(raw: string | undefined, url: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

function getBrowserSessionStorageKey(persistKey: string): string {
  return `${BROWSER_SESSION_KEY_PREFIX}${persistKey}`;
}

function readBrowserSession(persistKey: string): PersistedBrowserSession {
  try {
    const raw = localStorage.getItem(getBrowserSessionStorageKey(persistKey));
    if (!raw) {
      return { tabs: [], activeTabId: null };
    }
    const parsed = JSON.parse(raw) as {
      tabs?: Array<Partial<BrowserTab>>;
      activeTabId?: unknown;
    };
    if (!Array.isArray(parsed.tabs)) {
      return { tabs: [], activeTabId: null };
    }

    const tabs: BrowserTab[] = parsed.tabs.flatMap((tab) => {
      if (!tab || typeof tab !== "object") return [];
      if (typeof tab.id !== "string" || tab.id.trim().length === 0) return [];
      if (typeof tab.url !== "string") return [];
      const title = typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title : "New Tab";
      return [{
        id: tab.id,
        url: tab.url,
        title,
        label: typeof tab.label === "string" && tab.label.trim().length > 0 ? tab.label : title,
        isLoading: Boolean(tab.isLoading),
        colorScheme: tab.colorScheme === "light" ? "light" : "dark",
        isStartPage: Boolean(tab.isStartPage),
      }];
    });

    const activeTabId = typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0]?.id ?? null;

    return { tabs, activeTabId };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function resolveNavigationInput(input: string): string | null {
  let url = input.trim();
  if (!url) return null;

  // If it looks like a URL, add protocol
  if (/^[\w-]+(\.[\w-]+)+/.test(url) && !url.includes(" ")) {
    url = `https://${url}`;
  } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
    // Treat as search query
    url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  return url;
}

function reorderTabsById(tabs: BrowserTab[], fromTabId: string, toTabId: string): BrowserTab[] {
  const fromIndex = tabs.findIndex((tab) => tab.id === fromTabId);
  const toIndex = tabs.findIndex((tab) => tab.id === toTabId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(fromIndex, 1);
  nextTabs.splice(toIndex, 0, movedTab);
  return nextTabs;
}

const BrowserHeaderIcon = forwardRef<SVGSVGElement, React.ComponentPropsWithoutRef<typeof Globe>>(
  ({ className, ...rest }, ref) => (
    <Globe ref={ref} {...rest} className={`${className ?? ""} text-sky-600/70 dark:text-sky-200/50`} />
  ),
);

export function BrowserPanel({ persistKey, onElementGrab, headerControls }: BrowserPanelProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => readBrowserSession(persistKey).tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => readBrowserSession(persistKey).activeTabId);
  const [inspectMode, setInspectMode] = useState(false);
  const [emptyInput, setEmptyInput] = useState("");
  const [showEmptySuggestions, setShowEmptySuggestions] = useState(false);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(BROWSER_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const normalized: BrowserHistoryEntry[] = [];
      for (const item of parsed) {
        if (typeof item === "string") {
          const url = normalizeHistoryUrl(item);
          if (!url) continue;
          normalized.push({ url, title: normalizeHistoryTitle(undefined, url) });
          continue;
        }
        if (item && typeof item === "object") {
          const rec = item as { url?: unknown; title?: unknown };
          const url = typeof rec.url === "string" ? normalizeHistoryUrl(rec.url) : null;
          if (!url) continue;
          const title = normalizeHistoryTitle(typeof rec.title === "string" ? rec.title : undefined, url);
          normalized.push({ url, title });
        }
      }
      return normalized.slice(0, MAX_BROWSER_HISTORY);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(BROWSER_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_BROWSER_HISTORY)));
    } catch {
      /* ignore localStorage errors */
    }
  }, [history]);

  useEffect(() => {
    const session = readBrowserSession(persistKey);
    setTabs(session.tabs);
    setActiveTabId(session.activeTabId);
    setInspectMode(false);
    setEmptyInput("");
    setShowEmptySuggestions(false);
  }, [persistKey]);

  useEffect(() => {
    try {
      localStorage.setItem(getBrowserSessionStorageKey(persistKey), JSON.stringify({
        tabs,
        activeTabId,
      }));
    } catch {
      /* ignore localStorage errors */
    }
  }, [activeTabId, persistKey, tabs]);

  const addHistoryEntry = useCallback((raw: string, title?: string) => {
    const normalized = normalizeHistoryUrl(raw);
    if (!normalized) return;
    const resolvedTitle = normalizeHistoryTitle(title, normalized);
    setHistory((prev) => {
      const deduped = prev.filter((entry) => entry.url !== normalized);
      return [{ url: normalized, title: resolvedTitle }, ...deduped].slice(0, MAX_BROWSER_HISTORY);
    });
  }, []);

  const createTab = useCallback((url?: string) => {
    const isStartPage = !url;
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: url ?? "",
      title: "New Tab",
      label: "New Tab",
      isLoading: !isStartPage,
      colorScheme: getDefaultBrowserColorScheme(),
      isStartPage,
    };
    setTabs((prev) => [...prev, tab]);
    capture("browser_tab_created");
    setActiveTabId(tab.id);
  }, []);

  const openFirstTab = useCallback((value?: string) => {
    const source = value ?? emptyInput;
    const resolved = resolveNavigationInput(source);
    if (!resolved) return;
    createTab(resolved);
    setEmptyInput("");
    setShowEmptySuggestions(false);
  }, [createTab, emptyInput]);

  const openTabFromStartPage = useCallback((tabId: string, input: string) => {
    const resolved = resolveNavigationInput(input);
    if (!resolved) return false;
    setTabs((prev) => prev.map((tab) => (tab.id === tabId
      ? { ...tab, url: resolved, isLoading: true, isStartPage: false }
      : tab)));
    return true;
  }, []);

  const emptyFilteredHistory = useMemo(() => {
    const query = emptyInput.trim().toLowerCase();
    if (!query) return history.slice(0, 8);
    return history
      .filter((entry) =>
        entry.url.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [history, emptyInput]);

  const emptyCompletion = useMemo(() => {
    const query = emptyInput.trim().toLowerCase();
    if (!query) return undefined;
    return history.find((entry) => {
      const lower = entry.url.toLowerCase();
      return lower.startsWith(query) && lower !== query;
    })?.url;
  }, [history, emptyInput]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const updateTab = useCallback((tabId: string, updates: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const merged = { ...t, ...updates };
      // Keep label in sync with title
      merged.label = merged.title || "New Tab";
      return merged;
    }));
  }, []);

  const reorderTabs = useCallback((fromTabId: string, toTabId: string) => {
    setTabs((prev) => reorderTabsById(prev, fromTabId, toTabId));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={() => createTab()}
        headerIcon={BrowserHeaderIcon}
        headerLabel="Browser"
        renderTabIcon={(tab) =>
          tab.isLoading ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin opacity-50" />
          ) : (
            <Globe className="h-2.5 w-2.5 opacity-50" />
          )
        }
        tabMaxWidth="max-w-24"
        activeClass="bg-foreground/[0.08] text-foreground/80"
        inactiveClass="text-foreground/35 hover:text-foreground/55 hover:bg-foreground/[0.04]"
        onReorderTabs={reorderTabs}
        headerActions={headerControls}
      />

      {/* Webview content */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 flex flex-col ${tab.id === activeTabId ? "visible" : "invisible"}`}
          >
            {tab.isStartPage ? (
              <BrowserStartPage
                input={emptyInput}
                setInput={setEmptyInput}
                showSuggestions={showEmptySuggestions}
                setShowSuggestions={setShowEmptySuggestions}
                filteredHistory={emptyFilteredHistory}
                completion={emptyCompletion}
                onOpen={(value) => {
                  const opened = openTabFromStartPage(tab.id, value);
                  if (opened) {
                    setEmptyInput("");
                    setShowEmptySuggestions(false);
                  }
                }}
                recentHistory={history.slice(0, 6)}
              />
            ) : (
              <WebviewInstance
                tab={tab}
                onUpdateTab={(updates) => updateTab(tab.id, updates)}
                onNavigate={(url) => updateTab(tab.id, { url, isLoading: true, isStartPage: false })}
                history={history}
                onVisitUrl={addHistoryEntry}
                inspectMode={inspectMode && tab.id === activeTabId}
                onToggleInspect={() => setInspectMode((prev) => !prev)}
                onElementGrab={(element) => {
                  setInspectMode(false); // One-shot: auto-disable after grab
                  onElementGrab?.(element);
                }}
                onInspectCancel={() => setInspectMode(false)}
              />
            )}
          </div>
        ))}
        {tabs.length === 0 && (
          <BrowserStartPage
            input={emptyInput}
            setInput={setEmptyInput}
            showSuggestions={showEmptySuggestions}
            setShowSuggestions={setShowEmptySuggestions}
            filteredHistory={emptyFilteredHistory}
            completion={emptyCompletion}
            onOpen={(value) => openFirstTab(value)}
            recentHistory={history.slice(0, 6)}
          />
        )}
      </div>
    </div>
  );
}

function BrowserStartPage({
  input,
  setInput,
  showSuggestions,
  setShowSuggestions,
  filteredHistory,
  completion,
  onOpen,
  recentHistory,
}: {
  input: string;
  setInput: (value: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  filteredHistory: BrowserHistoryEntry[];
  completion?: string;
  onOpen: (value: string) => void;
  recentHistory: BrowserHistoryEntry[];
}) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setShowSuggestions(false);
          const form = e.currentTarget;
          const active = document.activeElement;
          if (active instanceof HTMLElement && form.contains(active)) {
            active.blur();
          }
          onOpen(input);
        }}
        className="w-full max-w-sm"
      >
        {/* Search bar */}
        <div className="relative">
          <div className="flex items-center gap-2 rounded-md border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1.5 transition-colors focus-within:border-foreground/[0.15] focus-within:bg-foreground/[0.05]">
            <Search className="h-3.5 w-3.5 shrink-0 text-foreground/25" />

            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setShowSuggestions(true);
                }}
                onMouseDown={(e) => {
                  if (document.activeElement === e.currentTarget) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setShowSuggestions(false), 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowSuggestions(false);
                    (e.target as HTMLInputElement).blur();
                    return;
                  }
                  if (e.key === "Tab" && completion) {
                    e.preventDefault();
                    setInput(completion);
                  }
                }}
                className="w-full bg-transparent text-[12px] text-foreground/80 outline-none placeholder:text-foreground/25"
                placeholder="Search or enter URL…"
                spellCheck={false}
                autoFocus
              />
              {completion && input.trim() && (
                <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-[12px]">
                  <span className="invisible whitespace-pre">{input}</span>
                  <span className="text-foreground/[0.12]">{completion.slice(input.length)}</span>
                </div>
              )}
            </div>

            {completion && input.trim() && (
              <kbd className="shrink-0 rounded border border-foreground/[0.06] bg-foreground/[0.03] px-1 py-px text-[9px] font-medium text-foreground/20">
                Tab
              </kbd>
            )}

            {input.trim() && (
              <button
                type="submit"
                className="shrink-0 rounded p-1 text-foreground/30 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/60"
              >
                <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Suggestions dropdown */}
          {showSuggestions && filteredHistory.length > 0 && (
            <div className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-y-auto rounded-lg border border-foreground/[0.1] bg-[var(--background)] shadow-lg">
              {filteredHistory.map((entry) => {
                let hostname = entry.url;
                try { hostname = new URL(entry.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
                return (
                  <button
                    key={entry.url}
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-1 text-start transition-colors hover:bg-foreground/[0.04]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setInput(entry.url);
                      setShowSuggestions(false);
                      onOpen(entry.url);
                    }}
                  >
                    <Globe className="h-3 w-3 shrink-0 text-foreground/20" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/65">{entry.title}</span>
                    <span className="shrink-0 truncate text-[10px] text-foreground/20 max-w-32">{hostname}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent history */}
        {recentHistory.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-foreground/25">
              Recent
            </div>
            <div className="space-y-px">
              {recentHistory.map((entry) => {
                let hostname = entry.url;
                try { hostname = new URL(entry.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
                return (
                  <button
                    key={`recent-${entry.url}`}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-foreground/[0.04]"
                    onClick={() => onOpen(entry.url)}
                  >
                    <Globe className="h-3 w-3 shrink-0 text-foreground/15" />
                    <span className="min-w-0 truncate text-[11px] text-foreground/60">{entry.title}</span>
                    <span className="ms-auto shrink-0 text-[10px] text-foreground/20">{hostname}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </form>
      </div>
    </div>
  );
}

function WebviewInstance({
  tab,
  onUpdateTab,
  onNavigate,
  history,
  onVisitUrl,
  inspectMode,
  onToggleInspect,
  onElementGrab,
  onInspectCancel,
}: {
  tab: BrowserTab;
  onUpdateTab: (updates: Partial<BrowserTab>) => void;
  onNavigate: (url: string) => void;
  history: BrowserHistoryEntry[];
  onVisitUrl: (url: string, title?: string) => void;
  inspectMode?: boolean;
  onToggleInspect?: () => void;
  onElementGrab?: (element: GrabbedElement) => void;
  onInspectCancel?: () => void;
}) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [urlInput, setUrlInput] = useState(tab.url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isSecure, setIsSecure] = useState(false);
  const [isDomReady, setIsDomReady] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const withWebview = useCallback(
    (
      action: (wv: ElectronWebviewElement) => void,
      options?: { requireDomReady?: boolean },
    ): boolean => {
      const wv = webviewRef.current;
      if (!wv) return false;
      if ((options?.requireDomReady ?? true) && !isDomReady) return false;
      action(wv);
      return true;
    },
    [isDomReady],
  );

  const applyColorScheme = useCallback(async () => {
    if (!isDomReady) return;

    const wv = webviewRef.current;
    if (!wv) return;

    const result = await window.claude.setBrowserColorScheme(wv.getWebContentsId(), tab.colorScheme);
    if (!result.ok) {
      throw new Error(result.error ?? "Failed to apply browser color scheme");
    }
  }, [isDomReady, tab.colorScheme]);

  // Sync URL input when tab url changes externally
  useEffect(() => {
    setUrlInput(tab.url);
  }, [tab.url]);

  // Keep callback refs fresh so the console-message listener always sees latest
  const onElementGrabRef = useRef(onElementGrab);
  onElementGrabRef.current = onElementGrab;
  const onInspectCancelRef = useRef(onInspectCancel);
  onInspectCancelRef.current = onInspectCancel;

  // Attach webview event listeners
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onDidNavigate = () => {
      const currentUrl = wv.getURL();
      const currentTitle = wv.getTitle() || currentUrl;
      setUrlInput(currentUrl);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ url: currentUrl, title: currentTitle, isLoading: false });
      onVisitUrl(currentUrl, currentTitle);
      // Navigation destroys injected scripts — reset inspect mode
      onInspectCancelRef.current?.();
    };

    const onDidStartLoading = () => {
      setIsDomReady(false);
      onUpdateTab({ isLoading: true });
    };

    const onDidStopLoading = () => {
      const currentUrl = wv.getURL();
      const currentTitle = wv.getTitle() || currentUrl;
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      setIsSecure(currentUrl.startsWith("https://"));
      onUpdateTab({ title: currentTitle, isLoading: false });
      onVisitUrl(currentUrl, currentTitle);
    };

    const onPageTitleUpdated = (e: Event) => {
      const ev = e as CustomEvent & { title: string };
      onUpdateTab({ title: ev.title });
    };
    const onDomReady = () => {
      setIsDomReady(true);
      setIsDevToolsOpen(wv.isDevToolsOpened());
    };
    const onDevToolsOpened = () => {
      setIsDevToolsOpen(true);
    };
    const onDevToolsClosed = () => {
      setIsDevToolsOpen(false);
    };

    // Listen for element grab messages from the injected inspector script
    const onConsoleMessage = (e: Event) => {
      const ev = e as Event & { message: string; level: number };
      try {
        const parsed = JSON.parse(ev.message);
        if (parsed?.[GRAB_MARKER] !== true) return;

        if (parsed.cancelled) {
          onInspectCancelRef.current?.();
          return;
        }

        if (parsed.data) {
          // Spread page-controlled data first so our id/url can't be overridden
          const element: GrabbedElement = {
            ...parsed.data,
            id: crypto.randomUUID(),
            url: wv.getURL(),
          };
          onElementGrabRef.current?.(element);
        }
      } catch {
        // Not our message — ignore parse errors from normal console output
      }
    };

    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-start-loading", onDidStartLoading);
    wv.addEventListener("did-stop-loading", onDidStopLoading);
    wv.addEventListener("page-title-updated", onPageTitleUpdated);
    wv.addEventListener("console-message", onConsoleMessage);
    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("devtools-opened", onDevToolsOpened);
    wv.addEventListener("devtools-closed", onDevToolsClosed);

    return () => {
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("did-start-loading", onDidStartLoading);
      wv.removeEventListener("did-stop-loading", onDidStopLoading);
      wv.removeEventListener("page-title-updated", onPageTitleUpdated);
      wv.removeEventListener("console-message", onConsoleMessage);
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("devtools-opened", onDevToolsOpened);
      wv.removeEventListener("devtools-closed", onDevToolsClosed);
    };
  }, [onUpdateTab, onVisitUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject or clean up the inspector script when inspect mode changes
  useEffect(() => {
    if (inspectMode) {
      const ok = withWebview((wv) => {
        wv.executeJavaScript(getInspectorScript()).catch(() => {
          // Webview may be in transient state during navigation — ignore.
        });
      });
      if (!ok) return;
    } else {
      const ok = withWebview((wv) => {
        wv.executeJavaScript(getCleanupScript()).catch(() => {});
      });
      if (!ok) return;
    }
  }, [inspectMode, withWebview]);

  useEffect(() => {
    applyColorScheme().catch((err) => {
      reportError("BROWSER_COLOR_SCHEME", err, { colorScheme: tab.colorScheme });
    });
  }, [applyColorScheme, tab.colorScheme]);

  const handleGoBack = useCallback(() => {
    withWebview((wv) => wv.goBack());
  }, [withWebview]);

  const handleGoForward = useCallback(() => {
    withWebview((wv) => wv.goForward());
  }, [withWebview]);

  const handleReloadOrStop = useCallback(() => {
    withWebview((wv) => {
      if (tab.isLoading) {
        wv.stop();
      } else {
        wv.reload();
      }
    });
  }, [tab.isLoading, withWebview]);

  const handleToggleColorScheme = useCallback(() => {
    onUpdateTab({ colorScheme: tab.colorScheme === "dark" ? "light" : "dark" });
  }, [onUpdateTab, tab.colorScheme]);

  const handleToggleDevTools = useCallback(() => {
    withWebview((wv) => {
      if (wv.isDevToolsOpened()) {
        wv.closeDevTools();
        setIsDevToolsOpen(false);
        return;
      }

      wv.openDevTools({ mode: "detach", activate: true });
      setIsDevToolsOpen(true);
    });
  }, [withWebview]);

  const canNavigateControls = isDomReady;
  const filteredHistory = useMemo(() => {
    const query = urlInput.trim().toLowerCase();
    if (!query) return history.slice(0, 8);
    return history
      .filter((entry) =>
        entry.url.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [history, urlInput]);
  const completion = useMemo(() => {
    const query = urlInput.trim().toLowerCase();
    if (!query) return undefined;
    return history.find((entry) => {
      const lower = entry.url.toLowerCase();
      return lower.startsWith(query) && lower !== query;
    })?.url;
  }, [history, urlInput]);

  const navigateTo = useCallback(
    (input: string) => {
      const url = resolveNavigationInput(input);
      if (!url) return;

      const currentUrl = webviewRef.current?.getURL() || tab.url;
      if (currentUrl && url === currentUrl) {
        setUrlInput(url);
        onUpdateTab({ isLoading: true });
        withWebview((wv) => wv.reload(), { requireDomReady: false });
        return;
      }

      setUrlInput(url);
      onNavigate(url);
    },
    [onNavigate, onUpdateTab, tab.url, withWebview],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    const form = e.currentTarget;
    const active = document.activeElement;
    if (active instanceof HTMLElement && form.contains(active)) {
      active.blur();
    }
    navigateTo(urlInput);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setUrlInput(tab.url);
      setShowSuggestions(false);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "Tab" && completion) {
      e.preventDefault();
      setUrlInput(completion);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {/* Nav button group */}
        <div className="flex shrink-0 items-center rounded-md border border-foreground/[0.08] bg-foreground/[0.02]">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center text-foreground/35 hover:text-foreground/65 hover:bg-foreground/[0.06] rounded-s-md transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            onClick={handleGoBack}
            disabled={!canNavigateControls || !canGoBack}
            title="Back"
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div className="h-3.5 w-px bg-foreground/[0.08]" />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center text-foreground/35 hover:text-foreground/65 hover:bg-foreground/[0.06] transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            onClick={handleGoForward}
            disabled={!canNavigateControls || !canGoForward}
            title="Forward"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
          <div className="h-3.5 w-px bg-foreground/[0.08]" />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center text-foreground/35 hover:text-foreground/65 hover:bg-foreground/[0.06] rounded-e-md transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            onClick={handleReloadOrStop}
            disabled={!canNavigateControls}
            title={tab.isLoading ? "Stop" : "Reload"}
          >
            {tab.isLoading ? (
              <XIcon className="h-3 w-3" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
          </button>
        </div>

        {/* Inspect button */}
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed ${
            inspectMode
              ? "border-blue-400/30 bg-blue-500/10 text-blue-400 hover:text-blue-300"
              : "border-foreground/[0.08] bg-foreground/[0.02] text-foreground/35 hover:text-foreground/65 hover:bg-foreground/[0.06]"
          }`}
          onClick={onToggleInspect}
          disabled={!canNavigateControls}
          title={inspectMode ? "Cancel inspect" : "Grab element"}
        >
          <Crosshair className="h-3 w-3" />
        </button>

        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/[0.08] bg-foreground/[0.02] transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed ${
            isDevToolsOpen
              ? "text-emerald-400 hover:text-emerald-300 bg-emerald-500/10"
              : "text-foreground/35 hover:text-foreground/65 hover:bg-foreground/[0.06]"
          }`}
          onClick={handleToggleDevTools}
          disabled={!canNavigateControls}
          title={isDevToolsOpen ? "Close inspector" : "Open inspector"}
        >
          <Bug className="h-3 w-3" />
        </button>

        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/[0.08] transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed ${
            tab.colorScheme === "dark"
              ? "bg-slate-900 text-sky-100 hover:bg-slate-800"
              : "bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}
          onClick={handleToggleColorScheme}
          disabled={!canNavigateControls}
          title={`Simulating ${tab.colorScheme} mode`}
        >
          {tab.colorScheme === "dark" ? (
            <Moon className="h-3 w-3" />
          ) : (
            <Sun className="h-3 w-3" />
          )}
        </button>

        {/* URL bar */}
        <form onSubmit={handleSubmit} className="relative min-w-0 flex-1">
          <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2 py-1 transition-colors focus-within:bg-foreground/[0.08] focus-within:ring-1 focus-within:ring-foreground/[0.08]">
            {isSecure ? (
              <Lock className="h-3 w-3 shrink-0 text-emerald-500/60" />
            ) : (
              <Globe className="h-3 w-3 shrink-0 text-foreground/25" />
            )}
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={(e) => {
                e.target.select();
                setShowSuggestions(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setShowSuggestions(false), 120);
              }}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
              placeholder="Search or enter URL"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {showSuggestions && filteredHistory.length > 0 && (
            <div className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-md border border-foreground/[0.08] bg-background py-1 shadow-lg">
              {filteredHistory.map((entry) => (
                <button
                  key={entry.url}
                  type="button"
                  className="block w-full px-2.5 py-1.5 text-start hover:bg-foreground/[0.05]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setUrlInput(entry.url);
                    setShowSuggestions(false);
                    navigateTo(entry.url);
                  }}
                >
                  <div className="truncate text-xs text-foreground/80">{entry.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{entry.url}</div>
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      {/* Loading bar */}
      {tab.isLoading && (
        <div className="h-px bg-foreground/[0.06] overflow-hidden">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/40" />
        </div>
      )}

      {/* Webview */}
      <div className="min-h-0 flex-1">
        <webview
          ref={webviewRef as React.RefObject<ElectronWebviewElement>}
          src={tab.url}
          className="h-full w-full"
          {...({ allowpopups: "true" } as Record<string, string>)}
        />
      </div>
    </div>
  );
}
