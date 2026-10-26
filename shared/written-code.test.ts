import { expect, it } from "vitest";
import type { AgentActivity, AgentTrace, WrittenCode } from "./projects";
import { answerWrittenLimit, capWritten, writtenInAnswer, writtenLimit } from "./written-code";

const wrote = (id: string, path: string, size: number): AgentActivity => ({
  id,
  kind: "file",
  status: "complete",
  label: path,
  written: [{ kind: "whole", path, content: "x".repeat(size) }],
});

const traceOf = (calls: AgentActivity[]): AgentTrace[] =>
  calls.map((activity) => ({ kind: "activity", id: activity.id, activity }));

const kept = (call: AgentActivity) => (call.written?.[0] as Extract<WrittenCode, { kind: "whole" }>).content.length;

it("keeps only the path of a file that may hold secrets, whatever kind of change it was", () => {
  expect(
    capWritten([
      { kind: "whole", path: "app/.env", content: "TOKEN=abc" },
      { kind: "swap", path: "/home/me/.ssh/id_ed25519", edits: [{ old: "a", new: "b" }] },
      { kind: "patch", path: "certs/server.pem", diff: "@@ -1 +1 @@\n-a\n+b" },
      { kind: "whole", path: ".env.example", content: "TOKEN=" },
    ]),
  ).toEqual([
    { kind: "whole", path: "app/.env", content: "", cut: true, secret: true },
    { kind: "swap", path: "/home/me/.ssh/id_ed25519", edits: [], cut: true, secret: true },
    { kind: "patch", path: "certs/server.pem", diff: "", cut: true, secret: true },
    { kind: "whole", path: ".env.example", content: "TOKEN=" },
  ]);
});

it("fits an answer's calls into its limit first come, first kept", () => {
  const calls = Array.from({ length: 14 }, (_, i) => wrote(`c${i}`, `f${i}.ts`, writtenLimit));
  const recorded: AgentActivity[] = [];
  for (const call of calls) recorded.push(writtenInAnswer(call, traceOf(recorded)));
  const total = recorded.reduce((n, call) => n + kept(call), 0);
  expect(total).toBe(answerWrittenLimit);
  expect(recorded.at(-1)!.written![0]).toMatchObject({ content: "", cut: true });
  // The first call finishing after the rest came in keeps all it had.
  expect(kept(writtenInAnswer(calls[0]!, []))).toBe(writtenLimit);
});
