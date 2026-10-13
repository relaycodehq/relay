import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "../../../shared/projects";
vi.mock("../../lib/api", () => ({ api: {} }));
import { AsyncQuestionCards } from "./AsyncQuestionCards";
import { AnsweredQuestions } from "../agent-turn/AnsweredQuestions";
const message: ChatMessage = {
  id: "m",
  role: "assistant",
  provider: "claude",
  status: "complete",
  body: "",
  created: 1,
  version: 1,
  questions: [
    {
      id: "q",
      questions: [{ id: "a", question: "Your token?", isSecret: true }],
    },
  ],
};
it("names the provider and masks answered secret questions", () => {
  const open = renderToStaticMarkup(
    <AsyncQuestionCards chatId="c" message={message} />,
  );
  expect(open).toContain("Claude has a question");
  expect(open).not.toContain("Codex has");
  const answered = renderToStaticMarkup(
    <AsyncQuestionCards
      chatId="c"
      message={{
        ...message,
        questions: [
          { ...message.questions![0], answers: { a: ["fixture-secret"] } },
        ],
      }}
    />,
  );
  expect(answered).toContain("Hidden answer");
  expect(answered).not.toContain("fixture-secret");
});

it("uses the native question row for answered async questions, including Codex", () => {
  const questions = [{ id: "a", question: "Which pages?" }];
  const answered = renderToStaticMarkup(
    <AsyncQuestionCards
      chatId="c"
      message={{
        ...message,
        provider: "codex",
        questions: [{ id: "q", questions, answers: { a: ["Home", "Blog"] } }],
      }}
    />,
  );
  const native = renderToStaticMarkup(
    <AnsweredQuestions
      questions={[{ question: "Which pages?", answer: "Home, Blog" }]}
    />,
  );
  expect(answered).toBe(`<div class="async-question-cards">${native}</div>`);
  expect(answered).not.toContain("agent-request");
});
