import { expect, it } from "vitest";
import {
  askedQuestions,
  isQuestionCall,
  questionAnswers,
} from "./asked-questions";
import { doneLabel, liveLabel, summarizeActivity } from "./activity-labels";
import { groupTrace } from "./agent-trace";
import type { AgentActivity } from "./projects";

const call = (detail: string, status: AgentActivity["status"] = "complete") =>
  ({
    id: "t",
    kind: "tool",
    label: "AskUserQuestion",
    status,
    detail,
  }) satisfies AgentActivity;

it("reads each question and answer from Claude Code's result", () => {
  // Saved from a real thread.
  expect(
    askedQuestions(
      call(
        'The user answered: "HubSpot forms (contact, demo requests…): where should submissions go after the move?"="Decide later", "Who will edit content after launch?"="later... for now, without this", "Some sitemap pages look like junk (import-test, migration/*). Drop them?"="Drop them (Recommended)". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
      ),
    ),
  ).toEqual([
    {
      question:
        "HubSpot forms (contact, demo requests…): where should submissions go after the move?",
      answer: "Decide later",
    },
    {
      question: "Who will edit content after launch?",
      answer: "later... for now, without this",
    },
    {
      question:
        "Some sitemap pages look like junk (import-test, migration/*). Drop them?",
      answer: "Drop them (Recommended)",
    },
  ]);
});

it("keeps a picked list and an answer with quotes whole", () => {
  expect(
    askedQuestions(
      call(
        'User has answered your questions: "Which pages?"="Home, Blog", "Name?"="the "new" one". You can now continue.',
      ),
    ),
  ).toEqual([
    { question: "Which pages?", answer: "Home, Blog" },
    { question: "Name?", answer: 'the "new" one' },
  ]);
});

it("keeps quoted words inside a question", () => {
  // Saved from a real thread, where the row showed only "?".
  expect(
    askedQuestions(
      call(
        'Your questions have been answered: "What did you mean by "switch is Y"?"="Yes, test on Switch", "Pick "a" or "b"?"="a". You can now continue with these answers in mind.',
      ),
    ),
  ).toEqual([
    {
      question: 'What did you mean by "switch is Y"?',
      answer: "Yes, test on Switch",
    },
    { question: 'Pick "a" or "b"?', answer: "a" },
  ]);
});

it("has nothing to read from a declined or unfinished card", () => {
  expect(
    askedQuestions(call("No answers provided.", "failed")),
  ).toBeUndefined();
  expect(askedQuestions(call("", "running"))).toBeUndefined();
  expect(askedQuestions(call("Something else entirely"))).toBeUndefined();
});

it("keeps structured Codex answers whole and gives them the same labels as Claude", () => {
  const questions = questionAnswers(
    [
      { id: "pages", question: 'Which "new" pages?' },
      { id: "note", question: "Any notes?" },
    ],
    { pages: ["Home", "Blog"], note: ['Keep the "old" title.\nFor now.'] },
  );
  const activity: AgentActivity = {
    id: "input",
    kind: "tool",
    label: "request_user_input",
    status: "complete",
    questionAnswers: questions,
  };
  expect(askedQuestions(activity)).toEqual([
    { question: 'Which "new" pages?', answer: "Home, Blog" },
    { question: "Any notes?", answer: 'Keep the "old" title.\nFor now.' },
  ]);
  expect(doneLabel(activity)).toBe("Asked you 2 questions");
  expect(summarizeActivity([activity])).toBe("Asked you 2 questions");
  expect(liveLabel({ ...activity, status: "running" })).toBe(
    "Waiting for your answer",
  );
  expect(askedQuestions({ ...activity, status: "running" })).toBeUndefined();
  expect(askedQuestions({ ...activity, status: "failed" })).toBeUndefined();
});

it("masks secret answers and names unanswered questions without leaking their values", () => {
  expect(
    questionAnswers(
      [
        { id: "token", question: "Your token?", isSecret: true },
        { id: "missing", question: "Your name?" },
      ],
      { token: ["fixture-secret"] },
    ),
  ).toEqual([
    { question: "Your token?", answer: "Hidden answer" },
    { question: "Your name?", answer: "No answer provided" },
  ]);
});

it("keeps Codex and Claude question calls separate from surrounding tool batches", () => {
  const activities: AgentActivity[] = [
    { id: "before", kind: "command", label: "ls", status: "complete" },
    { ...call(""), id: "claude" },
    {
      id: "codex",
      kind: "tool",
      label: "request_user_input",
      status: "complete",
    },
    { id: "after", kind: "read", label: "notes.md", status: "complete" },
  ];
  expect(
    groupTrace(
      activities.map((activity) => ({
        kind: "activity",
        id: activity.id,
        activity,
      })),
    ).map((part) => part.id),
  ).toEqual(["before", "claude", "codex", "after"]);
  expect(
    isQuestionCall({ ...activities[2], label: "request_user_input_async" }),
  ).toBe(false);
});
