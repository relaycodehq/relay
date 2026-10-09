import { describe, expect, it } from "vitest";
import type { UsageReport } from "../types";
import { RequestUsage } from "./request-usage";

const frame = (event: object) => ({ type: "stream_event", event });

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
});
