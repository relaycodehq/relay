// Sample usage log for the preview: six weeks shaped like a real Relay
// (Claude-heavy, some Codex, OpenCode and Cursor on the side), but made up.
import {
  summarizeUsage,
  type UsageChat,
  type UsageEntry,
  type UsageRange,
} from "../../shared/usage";

const now = new Date(2026, 9, 6, 16).getTime();
const DAY = 86_400_000;

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rng = random(42);
const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];

const titles = [
  "Usage page",
  "Phone low-data mode",
  "Read aloud: Supertonic",
  "Invoice export jobs",
  "Fix flaky worktrees spec",
  "Overnight god-file refactor",
  "Worktree bootstrap",
  "Thread timeline",
];
export const chats: UsageChat[] = Array.from({ length: 90 }, (_, i) => ({
  id: `c${i}`,
  title: i < titles.length ? titles[i] : `Sample thread ${i}`,
  projectId: i % 5 === 3 ? "p-tickets" : "p-relay",
  project: i % 5 === 3 ? "geen-ticketing" : "relay",
}));

const tok = (n: number) => ({
  input: Math.round(n * 0.05),
  cacheWrite: Math.round(n * 0.1),
  cacheRead: Math.round(n * 0.8),
  output: Math.round(n * 0.05),
});

const runners = [
  {
    provider: "claude",
    model: "claude-opus-5-5-20260901",
    weight: 0.62,
    perM: 2.2,
  },
  { provider: "claude", model: "claude-sonnet-5-5", weight: 0.14, perM: 0.9 },
  { provider: "codex", model: "gpt-6.1-sol", weight: 0.16, perM: 1.1 },
  {
    provider: "opencode",
    model: "openrouter/qwen-coder",
    weight: 0.05,
    perM: undefined,
  },
  { provider: "cursor", model: "auto", weight: 0.03, perM: undefined },
] as const;

const entries: UsageEntry[] = [];
for (let d = 41; d >= 0; d--) {
  const day = new Date(now - d * DAY);
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const runs = Math.round((weekend ? 14 : 38) * (0.6 + rng() * 0.8));
  for (let r = 0; r < runs; r++) {
    const at = new Date(day);
    at.setHours(
      // Leaning late, so the average day has an evening to point at.
      weekend
        ? 11 + Math.floor(rng() * 8)
        : 8 + Math.floor(Math.sqrt(rng()) * 15),
      Math.floor(rng() * 60),
    );
    if (at.getTime() > now) continue;
    let roll = rng();
    const runner = runners.find((x) => (roll -= x.weight) < 0) ?? runners[0];
    const n = 150_000 + rng() * 900_000;
    const models: UsageEntry["models"] = {
      [runner.model]: {
        tokens: tok(n),
        usd: runner.perM && (n / 1e6) * runner.perM,
        requests: 8,
      },
    };
    if (runner.provider === "claude" && rng() < 0.3)
      models["claude-haiku-4-5"] = {
        tokens: tok(n * 0.05),
        usd: (n * 0.05 * 0.25) / 1e6,
        requests: 2,
      };
    entries.push({
      at: at.getTime(),
      ms: (2 + rng() * 14) * 60_000,
      provider: runner.provider,
      job: "thread",
      chat: pick(chats.slice(0, Math.max(8, Math.round(90 - d * 2)))).id,
      project: "relay",
      answer: true,
      models,
    });
  }
  for (const [job, count, n] of [
    ["title", 6, 3000],
    ["commit", 4, 9000],
    ["watch", 10, 20000],
    ["triage", 1, 15000],
  ] as const)
    for (let i = 0; i < count; i++)
      entries.push({
        at: day.getTime() - (day.getHours() - 9 - i) * 3_600_000,
        ms: 0,
        provider: job === "commit" ? "codex" : "claude",
        job,
        answer: job !== "watch",
        models: {
          [job === "commit" ? "gpt-6.1-sol-mini" : "claude-haiku-4-5"]: {
            tokens: tok(n),
            usd: (n * 0.3) / 1e6,
            requests: 1,
          },
        },
      });
}
entries.sort((a, b) => a.at - b.at);

export const sampleSummary = (range: UsageRange) =>
  summarizeUsage(entries, { range, now, chats });
