import { describe, expect, it } from "vitest";
import { getAskUserQuestionAnswer, getAskUserQuestionKey } from "./ask-user-question";

describe("getAskUserQuestionKey", () => {
  it("uses a fallback key when Claude questions do not provide ids", () => {
    expect(getAskUserQuestionKey({ question: "First question?" }, 0)).toBe("question-0");
    expect(getAskUserQuestionKey({ question: "Second question?" }, 1)).toBe("question-1");
  });

  it("prefers the provided question id when available", () => {
    expect(getAskUserQuestionKey({ id: "q-1", question: "First question?" }, 0)).toBe("q-1");
  });
});

describe("getAskUserQuestionAnswer", () => {
  it("reads answers keyed by question id", () => {
    const answer = getAskUserQuestionAnswer(
      { id: "q-1", question: "Pick one" },
      0,
      {
        answersByQuestionId: {
          "q-1": ["Option A"],
        },
      },
    );

    expect(answer).toBe("Option A");
  });

  it("falls back to answers keyed by question text for Claude", () => {
    const answer = getAskUserQuestionAnswer(
      { question: "Second question?" },
      1,
      {
        answers: {
          "First question?": "Alpha",
          "Second question?": "Beta",
        },
      },
    );

    expect(answer).toBe("Beta");
  });

  it("falls back to indexed answers when keys do not match", () => {
    const answer = getAskUserQuestionAnswer(
      { question: "Second question?" },
      1,
      {
        answers: {
          first: "Alpha",
          second: "Beta",
        },
      },
    );

    expect(answer).toBe("Beta");
  });

  it("supports Codex-style structured answers", () => {
    const answer = getAskUserQuestionAnswer(
      { id: "q-2", question: "Choose many" },
      0,
      {
        answersByQuestionId: {
          "q-2": { answers: ["One", "Two"] },
        },
      },
    );

    expect(answer).toBe("One, Two");
  });
});
