import { expect, it } from "vitest";
import { askedQuestions } from "./asked-questions";
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

it("has nothing to read from a declined or unfinished card", () => {
  expect(
    askedQuestions(call("No answers provided.", "failed")),
  ).toBeUndefined();
  expect(askedQuestions(call("", "running"))).toBeUndefined();
  expect(askedQuestions(call("Something else entirely"))).toBeUndefined();
});
