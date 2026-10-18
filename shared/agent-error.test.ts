import { expect, it } from "vitest";
import { agentError, withDetails } from "./agent-error";

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

it("reads a CLI Relay couldn't find as not installed, so it isn't offered again", () => {
  // An older desktop's stored error names the Settings group "AI models".
  for (const group of ["AI & agents", "AI models"]) {
    const error = agentError(
      `codex was not found. Install it in Settings → ${group} → Agents, or put it on PATH.`,
    );
    expect(error.notInstalled).toBe(true);
    expect(error.message).toBe("codex isn't installed on this computer.");
    expect(error.hint).toContain("Settings → AI & agents → Agents");
  }
  expect(agentError("codex crashed").notInstalled).toBeUndefined();
});

it("doesn't misclassify a model error with a different cause", () => {
  const error =
    '{"error":{"message":"The model is not supported in this region."}}';
  expect(agentError(error)).toEqual({
    message: "The model is not supported in this region.",
    details: error,
  });
});

it("folds a crashed process's last words into the details, even when they look like JSON", () => {
  const said = 'panic: {"error":"boom"}';
  const message = "Codex stopped before finishing (exit code 2).";
  expect(agentError(withDetails(message, said))).toEqual({
    message,
    details: said,
  });
  expect(withDetails("Codex stopped.", "  ")).toBe("Codex stopped.");
});
