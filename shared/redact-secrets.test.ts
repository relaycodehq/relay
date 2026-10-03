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
});
