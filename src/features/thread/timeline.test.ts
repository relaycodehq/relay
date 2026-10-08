import { expect, it } from "vitest";
import { plainText, timelineTurns } from "./timeline";
import type { ChatMessage } from "../../../shared/projects";

const message = (
  id: string,
  role: ChatMessage["role"],
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  body,
  status: "complete",
  created: 0,
  provider: "claude",
  version: 1,
  ...extra,
});

it("pairs each prompt with the first answer that says something", () => {
  const { turns, turnOf } = timelineTurns([
    message("p1", "user", "Why does the phone drop?"),
    message("c", "assistant", "Compacted", { compaction: true }),
    message("a1", "assistant", "Android kills the socket."),
    message("a1b", "assistant", "Also the ping is too slow."),
    message("btw", "user", "what's doze?", { side: true }),
    message("p2", "user", "fix it"),
    message("a2", "assistant", "Fixing", { status: "streaming" }),
  ]);
  expect(turns).toEqual([
    {
      id: "p1",
      prompt: "Why does the phone drop?",
      answer: "Android kills the socket.",
      answering: false,
    },
    { id: "p2", prompt: "fix it", answer: "Fixing", answering: true },
  ]);
  // Rows and side questions belong to the turn they sit in, so the rail
  // knows which tick to light whichever of them is at the top.
  expect([...turnOf]).toEqual([
    ["p1", 0],
    ["c", 0],
    ["a1", 0],
    ["a1b", 0],
    ["btw", 0],
    ["p2", 1],
    ["a2", 1],
  ]);
});

it("gives an answer the agent started before any prompt a turn of its own", () => {
  const { turns } = timelineTurns([
    message("a0", "assistant", "The build finished.", { unprompted: true }),
    message("p1", "user", "", { images: [{} as never] }),
  ]);
  expect(turns.map((t) => [t.id, t.prompt])).toEqual([
    ["a0", "Started on its own"],
    ["p1", "Image"],
  ]);
});

it("reads Markdown as the sentence it says", () => {
  expect(
    plainText(
      "## Found it\n\nThe **fix** is in [`bridge.ts`](src/bridge.ts):\n\n```ts\nping(60)\n```\n\n- one _ahead_\n",
    ),
  ).toBe("Found it The fix is in bridge.ts: one ahead");
  expect(plainText("x".repeat(400), 10)).toBe("xxxxxxxxxx…");
});

it("shows a prompt's opening @mention as the agent, not as text", () => {
  const [turn] = timelineTurns([
    message("p1", "user", "@codex why is the build red?"),
  ]).turns;
  expect(turn).toMatchObject({
    agent: "codex",
    prompt: "why is the build red?",
  });
});

it("labels resume turns without showing the generated prompt in the timeline", () => {
  const { turns, turnOf } = timelineTurns([
    message(
      "resume",
      "user",
      "@codex Continue from where the previous response was stopped.",
      { resumed: true },
    ),
    message("answer", "assistant", "Checked the remaining changes."),
  ]);
  expect(turns).toEqual([
    {
      id: "resume",
      agent: "codex",
      prompt: "Resumed",
      answer: "Checked the remaining changes.",
      answering: false,
    },
  ]);
  expect(turnOf.get("answer")).toBe(0);
});

it("says what an answer that wrote nothing did instead of no answer", () => {
  const call = (id: string, kind: "command" | "file", label: string) => ({
    kind: "activity" as const,
    id,
    activity: { id, kind, label, status: "complete" as const },
  });
  const { turns } = timelineTurns([
    message("p1", "user", "stop and look at this instead"),
    message("a1", "assistant", "", {
      trace: [
        { kind: "commentary", id: "n1", text: "Reading the bridge." },
        call("c1", "command", "npm test"),
        { kind: "commentary", id: "n2", text: "The **ping** is late." },
      ],
    }),
    message("p2", "user", "go on"),
    message("a2", "assistant", "", {
      trace: [call("c2", "command", "ls"), call("c3", "file", "a.ts")],
    }),
  ]);
  expect(turns.map((t) => t.answer)).toEqual([
    "The ping is late.",
    "Ran 1 command and edited 1 file",
  ]);
});
