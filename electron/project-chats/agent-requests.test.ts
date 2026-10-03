import { it, expect } from "vitest";
import { AgentRequests } from "./agent-requests";
import { codexRequest } from "../agents/codex/codex-requests";
import { savedRuntimeMode } from "../../shared/agent-modes";

it("migrates saved choices without upgrading existing read-only/edit drafts to Full access", () => {
  expect(savedRuntimeMode(undefined)).toBe("full-access");
  expect(savedRuntimeMode("ask")).toBe("approval-required");
  expect(savedRuntimeMode("edit")).toBe("auto-accept-edits");
  expect(savedRuntimeMode("auto")).toBe("auto");
});
it("rejects unoffered decisions and releases requests when the provider cancels", async () => {
  const turn = new AbortController(),
    provider = new AbortController();
  const requests = new AgentRequests(turn.signal);
  const answer = requests.ask(
    { kind: "approval", title: "Test", decisions: ["accept", "decline"] },
    provider.signal,
  );
  const id = requests.list()[0].id;
  expect(() =>
    requests.respond(id, { kind: "approval", decision: "acceptForSession" }),
  ).toThrow("not offered");
  const rejection = expect(answer).rejects.toThrow("cancelled");
  provider.abort();
  await rejection;
  expect(requests.list()).toEqual([]);
  expect(() =>
    requests.respond(id, { kind: "approval", decision: "accept" }),
  ).toThrow("no longer");
});
it("forwards only permissions requested by the harness and scopes grants to the selected duration", async () => {
  const permissions = {
    network: { enabled: true },
    fileSystem: { write: ["/tmp/fixture"] },
  };
  expect(
    await codexRequest(
      "item/permissions/requestApproval",
      { permissions },
      async () => ({ kind: "approval", decision: "acceptForSession" }),
    ),
  ).toEqual({ permissions, scope: "session" });
  expect(
    await codexRequest(
      "item/permissions/requestApproval",
      { permissions },
      async () => ({ kind: "approval", decision: "decline" }),
    ),
  ).toEqual({ permissions: {}, scope: "turn" });
});
it("rejects unanswered and unknown questions without consuming the pending request", async () => {
  const requests = new AgentRequests(new AbortController().signal);
  const answer = requests.ask({
    kind: "question",
    title: "Question",
    questions: [{ id: "approach", question: "Approach?" }],
  });
  const id = requests.list()[0].id;
  expect(() =>
    requests.respond(id, {
      kind: "question",
      answers: { another: ["secret"] },
    }),
  ).toThrow("Unknown question");
  expect(() =>
    requests.respond(id, { kind: "question", answers: { approach: ["  "] } }),
  ).toThrow("Answer each question");
  requests.respond(id, {
    kind: "question",
    answers: { approach: ["Keep it small"] },
  });
  expect(await answer).toEqual({
    kind: "question",
    answers: { approach: ["Keep it small"] },
  });
});
