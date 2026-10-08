import { expect, it } from "vitest";
import { agentError } from "./agent-error";

it("explains an unsupported account model while keeping the exact diagnostic", () => {
  const error = JSON.stringify({
    type: "error",
    status: 400,
    error: {
      type: "invalid_request_error",
      message:
        "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    },
  });
  expect(agentError(error)).toEqual({
    message: "gpt-6.1-sol isn't available with your ChatGPT account.",
    hint: "Choose a different model in the composer, then resume the answer.",
    details: error,
  });
});

it("reads nested provider errors ahead of generic wrapper messages", () => {
  const error =
    'API Error: 429 {"message":"Request failed","error":{"message":"Too many requests. Try again later."}}';
  expect(agentError(error)).toEqual({
    message: "Too many requests. Try again later.",
    details: error,
  });
});

it("reads top-level messages and string errors", () => {
  expect(agentError('{"message":"Connection closed."}').message).toBe(
    "Connection closed.",
  );
  expect(agentError('{"error":"Permission denied."}').message).toBe(
    "Permission denied.",
  );
});

it("keeps plain and malformed errors readable without inventing advice", () => {
  for (const error of [
    "Connection failed.",
    '400 {"error":',
    "Couldn't read {file}.",
  ])
    expect(agentError(error)).toEqual({ message: error });
});

it("preserves unknown structured errors behind a readable fallback", () => {
  for (const error of ['{"error":{"code":500}}', '{"error":{"message":null}}'])
    expect(agentError(error)).toEqual({
      message: "The agent couldn't finish this answer.",
      details: error,
    });
});

it("doesn't misclassify a model error with a different cause", () => {
  const error =
    '{"error":{"message":"The model is not supported in this region."}}';
  expect(agentError(error)).toEqual({
    message: "The model is not supported in this region.",
    details: error,
  });
});
