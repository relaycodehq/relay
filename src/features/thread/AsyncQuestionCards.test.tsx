import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PAGE_QUESTION_ID, type ChatMessage } from "../../../shared/projects";
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
  expect(answered).toContain('class="answered-questions" open=""');
});

it("shows a reply's pending or missed status on its question and clears it when read", () => {
  const replied: ChatMessage = {
    ...message,
    questions: [
      {
        ...message.questions![0],
        answers: { a: ["secret"] },
        answerMessageId: "reply",
      },
    ],
  };
  const render = (reply: Partial<ChatMessage>) =>
    renderToStaticMarkup(
      <AsyncQuestionCards
        chatId="c"
        message={replied}
        answerMessages={
          new Map([
            ["reply", { ...message, id: "reply", role: "user", ...reply }],
          ])
        }
      />,
    );
  expect(render({ unread: true })).toContain("Sent · awaiting Claude");
  expect(render({ unread: false })).not.toContain('role="status"');
  expect(render({ missed: true })).toContain("Not read · turn stopped");
  expect(render({ unread: true })).not.toContain("spinner");
  const unrelated = renderToStaticMarkup(
    <AsyncQuestionCards
      chatId="c"
      message={replied}
      answerMessages={new Map([["other", { ...message, unread: true }]])}
    />,
  );
  expect(unrelated).not.toContain('role="status"');
});

it("keeps answered and skipped pages expanded with their response under the original title", () => {
  for (const skipped of [false, true]) {
    const html = renderToStaticMarkup(
      <AsyncQuestionCards
        chatId="c"
        message={{
          ...message,
          questions: [
            {
              id: "page",
              questions: [{ id: PAGE_QUESTION_ID, question: "Pick a sound" }],
              page: {
                id: "page",
                title: "Pick a sound",
                created: 1,
                pages: [],
              },
              answers: skipped
                ? {}
                : { [PAGE_QUESTION_ID]: ['{"sound":"glass"}'] },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('class="answered-questions" open=""');
    expect(html).toContain(
      skipped
        ? "Skipped &quot;Pick a sound&quot;"
        : "Answered &quot;Pick a sound&quot;",
    );
    expect(html).toContain(
      skipped ? ">Skipped</span>" : "&quot;sound&quot;:&quot;glass&quot;",
    );
  }
});
