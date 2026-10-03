import { expect, it, vi } from "vitest";
import type { ClaudeRunOptions } from "./config";
import { sessionCallbacks } from "./requests";

const computerUse = {
  serverName: "codex-cu",
  message: 'Allow Computer Use to use "Calculator"?',
  mode: "form" as const,
  requestedSchema: { type: "object", properties: {} },
};
const signal = new AbortController().signal;

function callbacks(answer: string, options: Partial<ClaudeRunOptions> = {}) {
  const onRequest = vi.fn(async () => ({
    kind: "approval" as const,
    decision: answer as "accept",
  }));
  const { onElicitation } = sessionCallbacks({
    options: { onRequest, ...options } as unknown as ClaudeRunOptions,
    plan: "",
  });
  return {
    onRequest,
    ask: (request = computerUse) =>
      onElicitation(request, { signal, requestId: "r" } as never),
  };
}

it("remembers an MCP server's question allowed for the session, and only that one", async () => {
  const { onRequest, ask } = callbacks("acceptForSession");
  expect(await ask()).toEqual({ action: "accept", content: {} });
  expect(await ask()).toEqual({ action: "accept", content: {} });
  expect(onRequest).toHaveBeenCalledTimes(1);
  await ask({ ...computerUse, message: 'Allow Computer Use to use "Finder"?' });
  expect(onRequest).toHaveBeenCalledTimes(2);
});

it("asks again after a one-time yes, and passes a no on", async () => {
  const once = callbacks("accept");
  await once.ask();
  await once.ask();
  expect(once.onRequest).toHaveBeenCalledTimes(2);
  expect(await callbacks("decline").ask()).toEqual({ action: "decline" });
});

it("declines what an approval card can't answer, and everything a reviewer is asked", async () => {
  const { onRequest, ask } = callbacks("accept");
  expect(
    await ask({
      ...computerUse,
      requestedSchema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    }),
  ).toEqual({ action: "decline" });
  expect(await ask({ ...computerUse, mode: "url" as never })).toEqual({
    action: "decline",
  });
  expect(onRequest).not.toHaveBeenCalled();
  const reviewer = callbacks("accept", { readOnly: true });
  expect(await reviewer.ask()).toEqual({ action: "decline" });
  expect(reviewer.onRequest).not.toHaveBeenCalled();
});
