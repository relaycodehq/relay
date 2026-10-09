// Made-up usage for the redesign preview: seventeen days of a Claude-heavy
// developer who works mornings and late evenings. Seeded, so it reads the
// same on every load; none of it comes from a real ledger.
type Spend = { usd: number; tok: number; work: number };

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rng = random(7);
const round = (x: Spend): Spend => ({
  usd: +x.usd.toFixed(2),
  tok: Math.round(x.tok),
  work: Math.round(x.work),
});
/** Dollars to tokens the way agents run: almost all of it re-read from cache. */
const spend = (usd: number, perDollar = 2_400_000): Spend => {
  const tok = usd * perDollar * (0.85 + rng() * 0.3);
  return { usd, tok, work: tok * (0.018 + rng() * 0.012) };
};

const nDays = 17;
const first = new Date(2026, 8, 23);
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A quiet night, a morning push, a lull after lunch, the big evening.
const hourShape = [
  4, 2, 1, 1, 1, 1, 2, 6, 9, 10, 8, 5, 4, 5, 6, 7, 8, 9, 11, 13, 12, 10, 8, 6,
];
const weekShape = [0.8, 1.3, 1.0, 1.2, 0.7, 0.9, 0.35];
const shapeSum = hourShape.reduce((n, v) => n + v, 0);

const days = Array.from({ length: nDays }, (_, i) => {
  const d = new Date(first);
  d.setDate(first.getDate() + i);
  const w = (d.getDay() + 6) % 7;
  const total = 260 * weekShape[w] * (0.4 + rng() * 1.2);
  return {
    day: dayKey(d),
    weekday: w,
    claude: round(spend(total * 0.9)),
    codex: round(spend(total * 0.09, 3_100_000)),
    opencode: round(spend(total * 0.01 * rng(), 900_000)),
    cursor: round({ usd: 0, tok: 0, work: 0 }),
  };
});

const daySum = (d: (typeof days)[number]) =>
  (["claude", "codex", "opencode"] as const).reduce(
    (n, p) => ({
      usd: n.usd + d[p].usd,
      tok: n.tok + d[p].tok,
      work: n.work + d[p].work,
    }),
    { usd: 0, tok: 0, work: 0 },
  );
const all = days.map(daySum).reduce((a, b) => ({
  usd: a.usd + b.usd,
  tok: a.tok + b.tok,
  work: a.work + b.work,
}));
const share = (part: number) => ({
  usd: all.usd * part,
  tok: all.tok * part,
  work: all.work * part,
});

const hours = hourShape.map((v) => {
  const jitter = 0.8 + rng() * 0.4;
  const s = share(((v / shapeSum) * jitter) / nDays);
  return { ...round(s), min: Math.round(v * 7 * jitter) };
});

const week = weekShape.map((_, w) => {
  const mine = days.filter((d) => d.weekday === w);
  const sum = mine
    .map(daySum)
    .reduce(
      (a, b) => ({
        usd: a.usd + b.usd,
        tok: a.tok + b.tok,
        work: a.work + b.work,
      }),
      { usd: 0, tok: 0, work: 0 },
    );
  const n = mine.length || 1;
  return {
    n: mine.length,
    ...round({ usd: sum.usd / n, tok: sum.tok / n, work: sum.work / n }),
    min: Math.round(weekShape[w] * 520 * (0.85 + rng() * 0.3)),
  };
});

const modelShares: [string, string, number][] = [
  ["Opus 5.5", "claude", 0.71],
  ["Sonnet 5.5", "claude", 0.12],
  ["Fable 5.1", "claude", 0.07],
  ["gpt-6.1-sol", "codex", 0.06],
  ["gpt-6-astra", "codex", 0.025],
  ["Haiku 5.5", "claude", 0.008],
  ["gpt-6-luna", "codex", 0.004],
  ["opencode/qwen-coder", "opencode", 0.002],
  ["Opus 4.8", "claude", 0.001],
];

export const sample = {
  nDays,
  answers: 3120,
  threads: 410,
  agentHours: 186,
  days: days.map(({ weekday: _, ...d }) => d),
  hours,
  week,
  models: modelShares.map(([model, provider, part]) => ({
    model,
    provider,
    ...round(share(part)),
  })),
  harnesses: (["claude", "codex", "opencode"] as const).map((provider) => ({
    provider,
    ...round(
      days.reduce(
        (n, d) => ({
          usd: n.usd + d[provider].usd,
          tok: n.tok + d[provider].tok,
          work: n.work + d[provider].work,
        }),
        { usd: 0, tok: 0, work: 0 },
      ),
    ),
  })),
  jobs: [
    { job: "watch", ...round(share(0.0058)) },
    { job: "title", ...round(share(0.0004)) },
    { job: "commit", ...round(share(0.0002)) },
  ],
  topThreads: [0.058, 0.049, 0.044, 0.036, 0.031].map((part) =>
    round(share(part)),
  ),
};
