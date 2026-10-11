import { describe, expect, it } from "vitest";
import type { UsageReport } from "../types";
import { RequestUsage } from "./request-usage";

const frame = (
  event: Parameters<RequestUsage["observe"]>[0]["event"],
  parent?: string,
) => ({
  type: "stream_event",
  parent_tool_use_id: parent ?? null,
  event,
});

describe("RequestUsage", () => {
  it("marks a request Claude served in fast mode", () => {
    const reports: UsageReport[] = [];
    const requests = new RequestUsage();
    const report = (u: UsageReport) => reports.push(u);
    for (const speed of ["fast", "standard"]) {
      requests.observe(
        frame({
          type: "message_start",
          message: {
            model: "claude-opus-5-5",
            usage: { input_tokens: 10, speed },
          },
        }),
        report,
      );
      requests.observe(
        frame({ type: "message_delta", usage: { output_tokens: 5 } }),
        report,
      );
    }
    expect(reports.map((r) => r.fast)).toEqual([true, undefined]);
  });

  it("times each request while it writes, not while it waits for the first token", () => {
    let clock = 0;
    const reports: UsageReport[] = [];
    const requests = new RequestUsage(() => clock);
    const report = (u: UsageReport) => reports.push(u);
    const request = (
      output: number,
      wait: number,
      writing: number,
      parent?: string,
    ) => {
      const start = { model: "claude-opus-5-5", usage: { input_tokens: 1 } };
      requests.observe(
        frame({ type: "message_start", message: start }, parent),
        report,
      );
      clock += wait;
      requests.observe(frame({ type: "content_block_start" }, parent), report);
      clock += writing;
      requests.observe(
        frame(
          { type: "message_delta", usage: { output_tokens: output } },
          parent,
        ),
        report,
      );
    };
    request(900, 2000, 10_000);
    request(300, 0, 3000, "toolu_1");
    // Frames read back in one burst after a restart: no real time passed.
    request(900, 0, 0);
    expect(
      reports.map((r) => ({ streamed: r.streamed, subagent: r.subagent })),
    ).toEqual([
      { streamed: { output: 900, ms: 10_000 }, subagent: undefined },
      { streamed: { output: 300, ms: 3000 }, subagent: true },
      { streamed: undefined, subagent: undefined },
    ]);
  });

  // Block timings from a real Opus request that thought before answering.
  it("leaves thinking out, the way Codex has to leave out reasoning", () => {
    let clock = 0;
    const reports: UsageReport[] = [];
    const requests = new RequestUsage(() => clock);
    const report = (u: UsageReport) => reports.push(u);
    const at = (ms: number, event: Parameters<typeof frame>[0]) => {
      clock = ms;
      requests.observe(frame(event), report);
    };
    const thinkThenAnswer = (details?: { thinking_tokens: number }) => {
      at(0, { type: "message_start", message: { model: "claude-opus-5-5" } });
      at(1368, {
        type: "content_block_start",
        content_block: { type: "thinking" },
      });
      at(5749, { type: "content_block_stop" });
      at(5749, {
        type: "content_block_start",
        content_block: { type: "text" },
      });
      at(6111, { type: "content_block_stop" });
      at(6123, {
        type: "message_delta",
        usage: { output_tokens: 495, output_tokens_details: details },
      });
    };
    thinkThenAnswer({ thinking_tokens: 461 });
    // An older CLI that doesn't say how much was thinking.
    thinkThenAnswer();
    expect(reports.map((r) => r.streamed)).toEqual([
      { output: 34, ms: 362 },
      undefined,
    ]);
  });
});
