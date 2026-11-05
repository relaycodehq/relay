import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact-secrets";

// Joined at runtime so secret scanners don't flag these fixtures in the repo.
const fake = (...parts: string[]) => parts.join("");
const github = fake("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
const aws = fake("AK", "IA", "Z7Q2XK4M9WPL3RTB");
const slack = fake("xo", "xb-", "1234567890-0987654321-AbCdEfGhIjKl");
const anthropic = fake("sk-", "ant-", "api03-Xy9Wv8Ut7Sr6Qp5On4Ml3Kj2");
const openai = fake("sk-", "proj-", "Zx8Cv7Bn6Mm5Ll4Kk3Jj2Hh1Gg0");

const jwt = fake(
  "eyJ",
  "hbGciOiJIUzI1NiJ9",
  ".eyJ",
  "zdWIiOiIxMjM0NTY3ODkwIn0",
  ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
);

const pem = [
  fake("-----BEGIN ", "RSA PRIVATE KEY-----"),
  "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun",
  "VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK",
  fake("-----END ", "RSA PRIVATE KEY-----"),
].join("\n");

// redactSecrets before it skipped runs, to compare against.
const oldTokens: [name: string, pattern: RegExp][] = [
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
const oldReference = String.raw`(?![$<{%*]|\[redacted|process\.env|os\.environ)`;

/** Keeps the name or header, drops the value after it. */
const oldValues: RegExp[] = [
  new RegExp(
    String.raw`(\bAuthorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|token)\s+)${oldReference}([A-Za-z0-9._~+/=-]{12,})`,
    "gi",
  ),
  new RegExp(
    String.raw`(\bBearer\s+)${oldReference}([A-Za-z0-9._~+/-]{20,}=*)`,
    "g",
  ),
  new RegExp(
    String.raw`(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)${oldReference}([^\s@/]+)(?=@)`,
    "gi",
  ),
  // https://<PAT>@dev.azure.com: a token as the whole user part. Plain
  // usernames are shorter or have no digits.
  new RegExp(
    String.raw`(\b[a-z][a-z0-9+.-]*://)${oldReference}(?=[^\s:/@]*\d)([A-Za-z0-9_-]{32,})(?=@)`,
    "gi",
  ),
  // X-API-Key: …, PRIVATE-TOKEN: …, Ocp-Apim-Subscription-Key: …, always
  // hyphenated, so code's `apiKey: config.key` stays. A quoted name is code
  // too, whose secret is quoted: `"x-api-key": this.key` stays.
  new RegExp(
    String.raw`(\b(?:[A-Za-z]+-)*(?:API-Key|Auth-Token|Access-Token|Private-Token|Subscription-Key|Functions-Key)(?:\s*:\s*["']?|["']\s*:\s*["']))${oldReference}([A-Za-z0-9._~+/=-]{12,})`,
    "gi",
  ),
  // SECRET=…, export GITHUB_TOKEN=…, API_KEY: …
  new RegExp(
    String.raw`^([ \t]*(?:export[ \t]+)?(?:[A-Z0-9]+_)*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[ \t]*[=:][ \t]*["']?)${oldReference}([^\s"'\x60]{8,})`,
    "gm",
  ),
  // "api_key": "…", password = '…', apiKey: "…"
  new RegExp(
    String.raw`(\b[\w-]*(?:secret|password|passwd|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["'])${oldReference}([^"'\s]{8,})(?=["'])`,
    "gi",
  ),
];

function quadraticRedactSecrets(text: string) {
  let found = 0;
  for (const [name, pattern] of oldTokens)
    text = text.replace(pattern, () => (found++, `[redacted ${name}]`));
  for (const pattern of oldValues)
    text = text.replace(
      pattern,
      (_, kept: string) => (found++, `${kept}[redacted]`),
    );
  return { text, found };
}

describe("redactSecrets", () => {
  it("names each key it removes and keeps the prose around it", () => {
    const { text, found } = redactSecrets(
      [
        `Push failed with ${github}, so I tried the AWS key ${aws}.`,
        `The bot posts with ${slack}; Claude uses ${anthropic} and Codex ${openai}.`,
        `Session cookie: ${jwt}`,
        "```",
        pem,
        "```",
      ].join("\n"),
    );
    expect(text).toBe(
      [
        "Push failed with [redacted GitHub token], so I tried the AWS key [redacted AWS key].",
        "The bot posts with [redacted Slack token]; Claude uses [redacted Anthropic key] and Codex [redacted OpenAI key].",
        "Session cookie: [redacted JWT]",
        "```",
        "[redacted private key]",
        "```",
      ].join("\n"),
    );
    expect(found).toBe(7);
  });

  it("keeps variable names and hosts, dropping only their values", () => {
    const { text } = redactSecrets(
      [
        "```sh",
        `export GITHUB_TOKEN=${github}`,
        "DB_PASSWORD=hunter2hunter2",
        "DATABASE_URL=postgres://relay:s3cr3t-pass@db.internal:5432/relay",
        "curl -H 'Authorization: Bearer abcdef0123456789abcdef' https://api.example.com",
        "```",
        'const config = { apiKey: "live-9f8e7d6c5b4a" };',
      ].join("\n"),
    );
    expect(text).toBe(
      [
        "```sh",
        "export GITHUB_TOKEN=[redacted GitHub token]",
        "DB_PASSWORD=[redacted]",
        "DATABASE_URL=postgres://relay:[redacted]@db.internal:5432/relay",
        "curl -H 'Authorization: Bearer [redacted]' https://api.example.com",
        "```",
        'const config = { apiKey: "[redacted]" };',
      ].join("\n"),
    );
  });

  it("cuts a truncated private key off at its code fence", () => {
    const head = pem.split("\n").slice(0, 2).join("\n");
    expect(
      redactSecrets(`\`\`\`\n${head}\n\`\`\`\nThat key is expired.`),
    ).toEqual({
      text: "```\n[redacted private key]\n```\nThat key is expired.",
      found: 1,
    });
  });

  it("leaves hashes, ids, config names and references alone", () => {
    const text = [
      "Commit 38edd0e5c1a4b7f2d9e8c3b6a1f4d7e2c5b8a9f0 fixed it; request 1b4e28ba-2fa1-11d2-883f-0016cb4b0e5d.",
      "Install scikit-learn, not sk-learn, and check task-queue-worker-shutdown-timeout.",
      "MAX_TOKENS=4096",
      "TOKEN_URL=https://auth.example.com/oauth/token",
      "API_KEY=process.env.API_KEY",
      'token: "${{ secrets.GITHUB_TOKEN }}"',
      'password: "<your password>"',
      "Open http://127.0.0.1:5177/previews/share.html and use Bearer tokens.",
    ].join("\n");
    expect(redactSecrets(text)).toEqual({ text, found: 0 });
  });

  it("drops a token used as a bare URL username", () => {
    const pat = fake("x7k2m9q4w8e3r5t6y1u0i2o4p6a8s0d2", "f4g6h8j0k2l4");
    const { text, found } = redactSecrets(
      `git clone https://${pat}@dev.azure.com/acme/relay/_git/relay`,
    );
    expect(text).toBe(
      "git clone https://[redacted]@dev.azure.com/acme/relay/_git/relay",
    );
    expect(found).toBe(1);
  });

  it("keeps plain URL usernames", () => {
    const text = [
      "ssh://git@github.com/acme/relay.git",
      "https://jane.doe@dev.azure.com/acme/_git/relay",
      "https://acme-engineering-platform@dev.azure.com/acme/_git/relay",
    ].join("\n");
    expect(redactSecrets(text)).toEqual({ text, found: 0 });
  });

  it("drops the value of an API key header", () => {
    const { text } = redactSecrets(
      [
        "curl -H 'X-API-Key: 9f8e7d6c5b4a3f2e1d0c' https://api.example.com",
        "X-Api-Key: 9f8e7d6c5b4a3f2e1d0c",
        'curl -H "PRIVATE-TOKEN: 9f8e7d6c5b4a3f2e1d0c" https://gitlab.example.com',
        "Ocp-Apim-Subscription-Key: 9f8e7d6c5b4a3f2e1d0c",
      ].join("\n"),
    );
    expect(text).toBe(
      [
        "curl -H 'X-API-Key: [redacted]' https://api.example.com",
        "X-Api-Key: [redacted]",
        'curl -H "PRIVATE-TOKEN: [redacted]" https://gitlab.example.com',
        "Ocp-Apim-Subscription-Key: [redacted]",
      ].join("\n"),
    );
  });

  it("keeps code that names an API key header or field", () => {
    const text = [
      "const client = new OpenAI({ apiKey: config.openaiApiKey });",
      'headers: { "x-api-key": this.options.apiKey },',
      "X-Request-Id: 3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6a7b",
    ].join("\n");
    expect(redactSecrets(text)).toEqual({ text, found: 0 });
  });

  it("drops a quoted subscription key", () => {
    const json = '{ "Ocp-Apim-Subscription-Key": "9f8e7d6c5b4a3f2e1d0c" }';
    expect(redactSecrets(json).text).toBe(
      '{ "Ocp-Apim-Subscription-Key": "[redacted]" }',
    );
  });

  it("takes linear time on long runs of near-secrets", () => {
    const inputs = [
      "https://" + "a".repeat(50_000),
      "https://a" + ":a".repeat(25_000),
      "X-API-Key: " + "a".repeat(50_000) + "\n",
      "Authorization: Bearer " + "a".repeat(50_000),
      "-----BEGIN PRIVATE KEY-----" + "a\n".repeat(25_000),
      "A_".repeat(25_000) + "TOKEN",
      "token".repeat(10_000),
    ];
    for (const input of inputs) {
      const started = performance.now();
      redactSecrets(input);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it("skips a long run of names in linear time", () => {
    const run = "a-".repeat(10_000);
    const started = performance.now();
    redactSecrets(run);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("redacts exactly what the per-position regexes did", () => {
    const pieces = [
      "a",
      "Z",
      "1",
      "_",
      "-",
      "--",
      ".",
      "+",
      ":",
      "://",
      "@",
      "/",
      " ",
      "\n",
      "\t",
      '"',
      "'",
      "=",
      "x-",
      "API-Key",
      "Private-Token",
      "secret",
      "PASSWORD",
      "token",
      "api_key",
      "export ",
      "Bearer ",
      "Authorization: ",
      "https://",
      "svn+ssh://",
      "$",
      "{",
      "ab12cd34ef56gh78ij90kl12mn34op56",
      "s3cr3tvalue",
      "a-a-",
      "[redacted",
    ];
    let seed = 1;
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % below;
    };
    let hits = 0;
    for (let i = 0; i < 20_000; i++) {
      let input = "";
      const length = 1 + random(30);
      for (let j = 0; j < length; j++) input += pieces[random(pieces.length)];
      const expected = quadraticRedactSecrets(input);
      expect(redactSecrets(input), input).toEqual(expected);
      if (expected.found) hits++;
    }
    expect(hits).toBeGreaterThan(500);
  });
});
