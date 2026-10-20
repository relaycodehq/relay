/** Read provider error envelopes without changing the saved diagnostic. */
function envelopeMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  return (
    envelopeMessage(record.error) ??
    (typeof record.message === "string"
      ? record.message.trim() || undefined
      : undefined)
  );
}

/** Where an error's own technical details start; see `withDetails`. */
const DETAILS = "\n\nTechnical details:\n";

/** `message` with `details` (a crashed process's last words) for the error's fold. */
export const withDetails = (message: string, details?: string) =>
  details?.trim() ? `${message}${DETAILS}${details.trim()}` : message;

export function agentError(error: string): {
  message: string;
  hint?: string;
  details?: string;
  /** The agent's program isn't on this computer; going again won't help. */
  notInstalled?: boolean;
  /** ACP's documented authentication error, including answers saved before it was classified. */
  authenticationRequired?: boolean;
} {
  const at = error.indexOf(DETAILS);
  if (at >= 0)
    return {
      ...agentError(error.slice(0, at)),
      details: error.slice(at + DETAILS.length),
    };
  const raw = error.trim();
  if (/^Authentication required(?:: provider authentication required)?\.?$/i.test(raw))
    return {
      message: "The model provider needs you to sign in again.",
      authenticationRequired: true,
    };
  // electron/platform/executables.ts, when no copy of the CLI turns up.
  const missing = raw.match(
    // Older desktops said "AI models"; their stored errors still reach new readers.
    /^(\S+) was not found\. Install it in Settings → AI (?:models|& agents) → Agents, or put it on PATH\.$/,
  );
  if (missing)
    return {
      message: `${missing[1]} isn't installed on this computer.`,
      hint: "Set it up in Settings → AI & agents → Agents, or put it on PATH, then send again.",
      notInstalled: true,
    };
  let message = raw;
  let structured = false;
  // CLIs sometimes prefix the response with an HTTP status or "API Error:".
  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      const value: unknown = JSON.parse(raw.slice(start));
      message =
        envelopeMessage(value) ?? "The agent couldn't finish this answer.";
      structured = true;
    } catch {
      // Plain text and malformed responses still need to be readable verbatim.
    }
  }
  const unsupported = message.match(
    /^The ['"]([^'"]+)['"] model is not supported when using Codex with a ChatGPT account\.?$/i,
  );
  if (unsupported)
    return {
      message: `${unsupported[1]} isn't available with your ChatGPT account.`,
      hint: "Choose a different model in the composer, then resume the answer.",
      details: error,
    };
  return { message, ...(structured ? { details: error } : {}) };
}
