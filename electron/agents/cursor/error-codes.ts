// What a run that ends with status "error" says in `error.code`. The SDK builds
// that code in `toRunError` from the same table `wrapSdkError` uses to choose
// between its AuthenticationError and RateLimitError classes (backend error
// names, or the lowercase gRPC code), so these lists are that table's.
const signedOut = new Set([
  "NOT_LOGGED_IN",
  "INVALID_AUTH_ID",
  "NOT_HIGH_ENOUGH_PERMISSIONS",
  "AGENT_REQUIRES_LOGIN",
  "AUTH_TOKEN_NOT_FOUND",
  "AUTH_TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "unauthenticated",
]);

const limited = new Set([
  "FREE_USER_RATE_LIMIT_EXCEEDED",
  "PRO_USER_RATE_LIMIT_EXCEEDED",
  "FREE_USER_USAGE_LIMIT",
  "PRO_USER_USAGE_LIMIT",
  "RESOURCE_EXHAUSTED",
  "OPENAI_RATE_LIMIT_EXCEEDED",
  "GENERIC_RATE_LIMIT_EXCEEDED",
  "GPT_4_VISION_PREVIEW_RATE_LIMIT",
  "API_KEY_RATE_LIMIT",
  "RATE_LIMITED",
  "RATE_LIMITED_CHANGEABLE",
  "resource_exhausted",
]);

/** The SDK's error class a failed run's code stands for, where Relay acts on it. */
export const cursorErrorName = (code: string | undefined) =>
  !code
    ? "Error"
    : signedOut.has(code)
      ? "AuthenticationError"
      : limited.has(code)
        ? "RateLimitError"
        : "Error";
