/**
 * Secrets in text that leaves this computer, replaced with a marker naming
 * what was there. Nobody reviews each hit, so every rule matches a format
 * that is hard to hit by accident. Generic high-entropy strings stay: commit
 * hashes and ids would drown the real keys.
 */
const tokens: [name: string, pattern: RegExp][] = [
  // A key cut off mid-block still goes, up to its code fence.
  [
    "private key",
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|(?=\n`{3})|$)/g,
  ],
  ["AWS key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g,
  ],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ["Slack token", /\bxox[abeposr]-[A-Za-z0-9-]{10,}/g],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  [
    "OpenAI key",
    /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/g,
  ],
  ["Stripe key", /\b[rs]k_live_[A-Za-z0-9]{20,}/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g],
];

/** A value that names its secret instead of holding it, or is already gone. */
const reference = String.raw`(?![$<{%*]|\[redacted|process\.env|os\.environ)`;

/** Keeps the name or header, drops the value after it. */
const values: RegExp[] = [
  new RegExp(
    String.raw`(\bAuthorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|token)\s+)${reference}([A-Za-z0-9._~+/=-]{12,})`,
    "gi",
  ),
  new RegExp(
    String.raw`(\bBearer\s+)${reference}([A-Za-z0-9._~+/-]{20,}=*)`,
    "g",
  ),
  new RegExp(
    String.raw`(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)${reference}([^\s@/]+)(?=@)`,
    "gi",
  ),
  // SECRET=…, export GITHUB_TOKEN=…, API_KEY: …
  new RegExp(
    String.raw`^([ \t]*(?:export[ \t]+)?(?:[A-Z0-9]+_)*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[ \t]*[=:][ \t]*["']?)${reference}([^\s"'\x60]{8,})`,
    "gm",
  ),
  // "api_key": "…", password = '…', apiKey: "…"
  new RegExp(
    String.raw`(\b[\w-]*(?:secret|password|passwd|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["'])${reference}([^"'\s]{8,})(?=["'])`,
    "gi",
  ),
];

export function redactSecrets(text: string) {
  let found = 0;
  for (const [name, pattern] of tokens)
    text = text.replace(pattern, () => (found++, `[redacted ${name}]`));
  for (const pattern of values)
    text = text.replace(
      pattern,
      (_, kept: string) => (found++, `${kept}[redacted]`),
    );
  return { text, found };
}

export const redacted = (text: string) => redactSecrets(text).text;
