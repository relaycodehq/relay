import { expect, it } from "vitest";
import {
  replyRoot,
  rootOf,
  turnImages,
  type AgentActivity,
  type ChatMessage,
} from "../projects";

const message = (
  id: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role: "assistant",
  body: id,
  status: "complete",
  created: 0,
  provider: "claude",
  version: 1,
  ...extra,
});
const read = (
  label: string,
  extra: Partial<AgentActivity> = {},
): AgentActivity => ({
  id: label,
  kind: "read",
  label,
  status: "complete",
  ...extra,
});

it("lists the images a turn read once each, in first-read order", () => {
  const m = message("a", {
    trace: [
      { kind: "commentary", id: "c", text: "Looking at shot.png" },
      { kind: "activity", id: "1", activity: read("/tmp/b.PNG") },
      { kind: "activity", id: "2", activity: read("src/app.ts") },
      // A subagent's read counts too.
      {
        kind: "activity",
        id: "3",
        activity: read("/tmp/a.jpeg", { parentId: "agent" }),
      },
      { kind: "activity", id: "4", activity: read("/tmp/b.PNG") },
      {
        kind: "activity",
        id: "5",
        activity: read("/tmp/c.png", { status: "failed" }),
      },
      {
        kind: "activity",
        id: "6",
        activity: read("/tmp/d.png", { kind: "file" }),
      },
      {
        kind: "activity",
        id: "7",
        activity: read("/tmp/loading.png", { status: "running" }),
      },
    ],
  });
  expect(turnImages(m)).toEqual(["/tmp/b.PNG", "/tmp/a.jpeg"]);
});

it("reads images from the activity list only when the turn has no trace", () => {
  const activity = [read("/tmp/old.png")];
  expect(turnImages(message("a", { activity }))).toEqual(["/tmp/old.png"]);
  expect(turnImages(message("a", { activity, trace: [] }))).toEqual([]);
  expect(turnImages(message("a"))).toEqual([]);
});

it("finds the message a reply chain starts from", () => {
  const messages = [
    message("q", { side: true }),
    message("r1", { parentId: "q" }),
    message("r2", { parentId: "r1" }),
  ];
  expect(replyRoot(messages, "r2").id).toBe("q");
  expect(replyRoot(messages, "q").id).toBe("q");
});

it("refuses a reply chain that is broken or loops", () => {
  const messages = [
    message("b", { parentId: "gone" }),
    message("c", { parentId: "b" }),
    message("x", { parentId: "y" }),
    message("y", { parentId: "x" }),
  ];
  expect(() => replyRoot(messages, "nope")).toThrow("missing");
  expect(() => replyRoot(messages, "c")).toThrow("missing");
  expect(() => replyRoot(messages, "x")).toThrow("Invalid reply chain.");
});

it("finds where a reply chain starts even when its first message is gone", () => {
  const messages = [
    message("a", { parentId: "gone" }),
    message("b", { parentId: "a" }),
    message("c", { parentId: "b" }),
    message("x", { parentId: "y" }),
    message("y", { parentId: "x" }),
  ];
  const root = (id: string) =>
    rootOf(
      messages,
      messages.find((m) => m.id === id)!,
    ).id;
  expect(root("c")).toBe("a");
  expect(root("a")).toBe("a");
  expect(root("x")).toBe("x");
});
