import { expect, it } from "vitest";
import { isAgentError } from "../errors";
import { CodexRequestError } from "./codex-transport";
import { codexRequestFailure } from "./codex-limits";

const missing =
  "invalid paginated history lineage for source-123: missing source rollout";
it.each(["thread/fork", "thread/resume"])(
  "classifies a missing rollout refused by %s before a turn starts",
  (method) => {
    expect(
      isAgentError(
        codexRequestFailure(
          new CodexRequestError(-32600, missing, undefined, method),
        ),
        "missingHistory",
      ),
    ).toBe(true);
  },
);
it.each([
  [-32600, missing, "turn/start"],
  [-32600, missing, "thread/start"],
  [-32000, missing, "thread/fork"],
  [-32600, "permission denied", "thread/fork"],
  [-32600, "connection lost", "thread/resume"],
] as const)(
  "does not recover an ambiguous or unrelated refusal (%s, %s, %s)",
  (code, message, method) => {
    const error = new CodexRequestError(code, message, undefined, method);
    expect(codexRequestFailure(error)).toBe(error);
  },
);
