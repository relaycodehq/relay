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

  // Frame timings from a real Opus request: its hidden thinking stayed open
  // while it wrote the answer, which then arrived in one 7ms burst.
  it("times the whole request, thinking included, since hidden thinking holds back the text", () => {
    let clock = 0;
    const reports: UsageReport[] = [];
    const requests = new RequestUsage(() => clock);
    const at = (ms: number, event: Parameters<typeof frame>[0]) => {
      clock = ms;
      requests.observe(frame(event), (u) => reports.push(u));
    };
    at(0, { type: "message_start", message: { model: "claude-opus-5-5" } });
    at(0, { type: "content_block_start", content_block: { type: "thinking" } });
    at(3244, { type: "content_block_stop" });
    at(3244, { type: "content_block_start", content_block: { type: "text" } });
    at(3251, { type: "content_block_stop" });
    at(3252, {
      type: "message_delta",
      usage: { output_tokens: 353 },
    });
    expect(reports.map((r) => r.streamed)).toEqual([{ output: 353, ms: 3251 }]);
  });
});
