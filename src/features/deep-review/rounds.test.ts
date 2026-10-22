import { expect, it } from "vitest";
import type { DeepReviewState } from "../../../shared/deep-review";
import type { ChatMessage } from "../../../shared/projects";
import { reviewRounds } from "./rounds";

const message = (id: string, role: ChatMessage["role"]) =>
  ({
    id,
    role,
    body: "",
    status: "complete",
    created: 0,
    version: 1,
  }) as ChatMessage;
const round = (patch: Partial<DeepReviewState>) =>
  ({
    request: "ask",
    reviewers: [],
    status: "reviewing",
    ...patch,
  }) as DeepReviewState;

it("takes the answer the round named as its lead, not one a steer continued below the request", () => {
  const messages = [
    message("answer", "assistant"),
    message("ask", "user"),
    message("steer", "user"),
    message("continued", "assistant"),
    message("lead", "assistant"),
  ];
  const waiting = round({ status: "stopped" });
  expect(reviewRounds(messages, [waiting]).leadOf(waiting)).toBeUndefined();
  const led = round({ status: "done", leadAnswer: "lead" });
  expect(reviewRounds(messages, [led]).leadOf(led)?.id).toBe("lead");
  // Saved before rounds named it: the first answer after the request.
  const old = round({ status: "done" });
  expect(reviewRounds(messages, [old]).leadOf(old)?.id).toBe("continued");
});
