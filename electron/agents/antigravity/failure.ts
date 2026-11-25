/**
 * What went wrong, when an answer is only the CLI passing on an error from
 * Google: "⚠ INVALID_ARGUMENT (code 400): …". It ends the turn as if it went well.
 */
export const antigravityFailure = (answer: string) =>
  /^⚠\uFE0F?\s*([A-Z_]+ \(code \d+\): .+)/s.exec(answer.trim())?.[1];
