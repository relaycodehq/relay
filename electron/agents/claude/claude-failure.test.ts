import { expect, it } from "vitest";
import { ClaudeFailureWatch } from "./claude-failure";

const apiError = {
  type: "assistant",
  error: "server_error",
  message: { content: [{ type: "text", text: "API Error: overloaded" }] },
};

const failed = { type: "result" };

it("says the error Claude answered with as the reason its result failed", () => {
  const watch = new ClaudeFailureWatch();
  watch.see(apiError);
  watch.see(failed);
  expect(watch.reason({})).toBe("API Error: overloaded");
});

it("doesn't blame a later failure on an error from an earlier result or one Claude got past", () => {
  const steered = new ClaudeFailureWatch();
  steered.see(apiError);
  steered.see({ type: "result" });
  steered.see({ type: "system" });
  steered.see(failed);
  expect(steered.reason({})).toBeUndefined();

  const recovered = new ClaudeFailureWatch();
  recovered.see(apiError);
  recovered.see({ type: "assistant", message: { content: "Carrying on." } });
  recovered.see(failed);
  expect(recovered.reason({})).toBeUndefined();
});

it("doesn't call a later failure a usage limit once the limit lets requests through again", () => {
  const watch = new ClaudeFailureWatch();
  watch.see({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: 1_900_000_000 },
  });
  watch.see({
    type: "rate_limit_event",
    rate_limit_info: { status: "allowed" },
  });
  watch.see(apiError);
  watch.see(failed);
  expect(watch.failure(true)).toBeUndefined();
  expect(watch.reason({})).toBe("API Error: overloaded");
});
