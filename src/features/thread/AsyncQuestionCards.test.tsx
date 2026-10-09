import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "../../../shared/projects";
vi.mock("../../lib/api", () => ({ api: {} }));
import { AsyncQuestionCards } from "./AsyncQuestionCards";
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
