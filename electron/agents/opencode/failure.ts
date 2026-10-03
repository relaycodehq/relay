import { redacted } from "../../../shared/redact-secrets";
import { signedOutError, usageLimitError } from "../errors";
import type { readFailure } from "./events";

/** When a provider's `Retry-After` (seconds, or a date) says it will answer again, in ms. */
function retryAt(headers: Record<string, string> | null | undefined) {
  const entry = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === "retry-after",
  );
  const value = entry?.[1].trim();
  if (!value) return;
  const at = /^\d+$/.test(value)
    ? Date.now() + Number(value) * 1000
    : Date.parse(value);
  return Number.isFinite(at) && at > Date.now() ? at : undefined;
}

const trimmed = (text: string | null | undefined) =>
  redacted(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

/**
 * The error a failed OpenCode turn ends in. OpenCode names a provider it has
 * no login for, and carries the provider's HTTP status on an API failure: 401
 * is a rejected key, 402 spent credit, 429 a rate or quota limit. Anything
 * else stays OpenCode's own words, since other statuses say nothing of the
 * account.
 */
export function openCodeFailure(
  failure: ReturnType<typeof readFailure>,
  fallback: string,
) {
  const data = failure?.data;
  const said = trimmed(data?.message);
  if (failure?.name === "ProviderAuthError")
    return signedOutError(
      "opencode",
      `OpenCode isn't signed in${data?.providerID ? ` to ${data.providerID}` : ""}. Sign in again, then resume the answer.`,
    );
  if (failure?.name === "APIError") {
    if (data?.statusCode === 401)
      return signedOutError(
        "opencode",
        "The provider rejected OpenCode's key. Sign in again, then resume the answer.",
      );
    if (data?.statusCode === 402)
      return usageLimitError(
        "opencode",
        `OpenCode is out of credit${said ? `: ${said}` : "."}`,
      );
    if (data?.statusCode === 429)
      return usageLimitError(
        "opencode",
        `OpenCode hit a rate or usage limit${said ? `: ${said}` : "."}`,
        retryAt(data.responseHeaders),
      );
  }
  return new Error(data?.message ?? failure?.name ?? fallback);
}
