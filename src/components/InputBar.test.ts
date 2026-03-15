import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { SlashCommand } from "@/types";
import {
  LOCAL_CLEAR_COMMAND,
  getAvailableSlashCommands,
  getSlashCommandReplacement,
  isClearCommandText,
} from "./InputBar";

// Mock localStorage for Node environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as any;

describe("InputBar slash command helpers", () => {
  it("always includes the local clear command first", () => {
    const commands: SlashCommand[] = [
      { name: "compact", description: "Compact context", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[0],
    ]);
  });

  it("deduplicates engine-provided clear commands in favor of the local one", () => {
    const commands: SlashCommand[] = [
      { name: "clear", description: "Engine clear", source: "claude" },
      { name: "help", description: "Help", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[1],
    ]);
  });

  it("detects the exact /clear command text", () => {
    expect(isClearCommandText("/clear")).toBe(true);
    expect(isClearCommandText("  /clear  ")).toBe(true);
    expect(isClearCommandText("/clear now")).toBe(false);
    expect(isClearCommandText("/compact")).toBe(false);
  });

  it("builds replacement text for local and engine commands", () => {
    expect(getSlashCommandReplacement(LOCAL_CLEAR_COMMAND)).toBe("/clear");
    expect(getSlashCommandReplacement({ name: "compact", description: "", source: "claude" })).toBe("/compact ");
    expect(getSlashCommandReplacement({ name: "open", description: "", source: "codex-app", appSlug: "jira" })).toBe("$jira ");
    expect(
      getSlashCommandReplacement({ name: "fix", description: "", source: "codex-skill", defaultPrompt: "bug" }),
    ).toBe("$fix bug");
  });
});

describe("Model favorites localStorage", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("persists favorite models to localStorage", () => {
    const favorites = ["claude-opus-4-5", "claude-sonnet-4-5"];
    localStorage.setItem("harnss-favorite-models", JSON.stringify(favorites));

    const stored = localStorage.getItem("harnss-favorite-models");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual(favorites);
  });

  it("loads favorite models from localStorage", () => {
    const favorites = ["claude-haiku-4"];
    localStorage.setItem("harnss-favorite-models", JSON.stringify(favorites));

    const stored = localStorage.getItem("harnss-favorite-models");
    const parsed = stored ? new Set(JSON.parse(stored)) : new Set();

    expect(parsed.has("claude-haiku-4")).toBe(true);
    expect(parsed.size).toBe(1);
  });

  it("handles empty favorites gracefully", () => {
    const stored = localStorage.getItem("harnss-favorite-models");
    expect(stored).toBeNull();

    const parsed = stored ? new Set(JSON.parse(stored)) : new Set();
    expect(parsed.size).toBe(0);
  });

  it("handles corrupted localStorage data", () => {
    localStorage.setItem("harnss-favorite-models", "invalid-json{");

    let parsed: Set<string>;
    try {
      const stored = localStorage.getItem("harnss-favorite-models");
      parsed = stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      parsed = new Set();
    }

    expect(parsed.size).toBe(0);
  });
});
