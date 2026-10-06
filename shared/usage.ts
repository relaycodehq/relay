// What the agents burned, counted on this computer and never sent anywhere.
// Main keeps one line per answer (electron/usage); the Usage page reads the
// summary built here.
import type { AgentProvider } from "./agents";
import { agentProviders } from "./agents";
import type { UsageSample } from "./usage-history";

export type UsageTokens = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

/** What an agent run was for: a thread's own work, a room's question, or one of Relay's jobs. */
export const usageJobs = [
  "thread",
  "room",
  "title",
  "commit",
  "watch",
  "triage",
  "plugin",
  "helper",
] as const;
export type UsageJob = (typeof usageJobs)[number];

/** Relay's own jobs, by what the page calls them. */
export const relayJobLabels: Record<
  Exclude<UsageJob, "thread" | "room">,
  string
> = {
  title: "Thread titles",
  commit: "Commit messages",
  watch: "Watcher checks",
  triage: "PR triage",
  plugin: "Plugins",
  helper: "Other helpers",
};

export type UsageModelSpend = {
  tokens: UsageTokens;
  /** Dollars at API list prices; absent for a model Relay has no price for. */
  usd?: number;
  requests: number;
};

/** One agent run, or what a session did after its run had ended. */
export type UsageEntry = {
  at: number;
  ms: number;
  provider: AgentProvider;
  job: UsageJob;
  chat?: string;
  project?: string;
  /** A run that answered something; work a session did between runs isn't. */
  answer: boolean;
  models: Record<string, UsageModelSpend>;
};

export const usageRanges = ["7d", "30d", "all"] as const;
export type UsageRange = (typeof usageRanges)[number];

export type PerProvider = Record<AgentProvider, number>;

export type UsageDay = {
  /** Local midnight. */
  day: number;
  tokens: PerProvider;
  usd: PerProvider;
  answers: number;
};

export type UsageSummary = {
  range: UsageRange;
  from: number;
  to: number;
  /** The first answer Relay counted, so the page can say how far back it knows. */
  since?: number;
  days: UsageDay[];
  totals: {
    tokens: number;
    usd: number;
    answers: number;
    /** Relay's own jobs. */
    relayTokens: number;
    relayUsd: number;
    agentMs: number;
  };
  harnesses: {
    provider: AgentProvider;
    tokens: number;
    usd: number;
    answers: number;
  }[];
  models: {
    model: string;
    provider: AgentProvider;
    tokens: number;
    usd: number;
    answers: number;
    /** Some of its tokens had no list price, so `usd` is short. */
    unpriced: boolean;
  }[];
  jobs: { job: UsageJob; runs: number; tokens: number; usd: number }[];
  threads: {
    chat: string;
    title: string;
    project: string;
    provider: AgentProvider;
    tokens: number;
    usd: number;
    answers: number;
  }[];
  /** Minutes agents were busy, by weekday (Monday first) and local hour. */
  heat: number[][];
  /** Weekly limit used, as Relay read it while open. */
  weekly: { at: number; claude: number | null; codex: number | null }[];
  /** Five-hour session windows seen to start, and those that hit 100%. */
  windows: { opened: number; ranOut: number };
  cards: { started: number; byAgents: number; settled: number };
  perThread: { tokensAvg: number; tokensMedian: number; answersAvg: number };
};

/** A thread as the summary needs it. */
export type UsageChat = {
  id: string;
  title: string;
  project: string;
  created: number;
  byAgent: boolean;
  settledAt?: number;
};

const DAY = 24 * 60 * 60_000;
const SPAN: Record<UsageRange, number | null> = {
  "7d": 7,
  "30d": 30,
  all: null,
};

export const tokenTotal = (t: UsageTokens) =>
  t.input + t.cacheWrite + t.cacheRead + t.output;

export const addTokens = (a: UsageTokens, b: UsageTokens): UsageTokens => ({
  input: a.input + b.input,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
});

export const noTokens = (): UsageTokens => ({
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
});

const perProvider = (): PerProvider =>
  Object.fromEntries(agentProviders.map((p) => [p, 0])) as PerProvider;

function midnight(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The next local midnight, a day on even across a daylight-saving change. */
function nextDay(day: number) {
  const d = new Date(day);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** "claude-opus-5-5-20260901[1m]" reads "Opus 5.5"; other models keep their id. */
export function modelLabel(model: string) {
  const bare = model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(bare);
  if (claude)
    return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  return bare;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Busy minutes of a run spread over the hours it covered. Runs overlap when
 * threads work side by side, so a busy hour can hold more than 60.
 */
function addHeat(heat: number[][], at: number, ms: number) {
  let t = at;
  const end = at + ms;
  while (t < end) {
    const d = new Date(t);
    const next = new Date(d);
    next.setMinutes(60, 0, 0);
    const stop = Math.min(end, next.getTime());
    heat[(d.getDay() + 6) % 7][d.getHours()] += (stop - t) / 60_000;
    t = stop;
  }
}

/**
 * Five-hour windows from session readings: one opens when the session
 * percent climbs from (near) zero, and ran out when it reached 100.
 */
function sessionWindows(samples: UsageSample[]) {
  let opened = 0;
  let ranOut = 0;
  let open = false;
  let out = false;
  let last: number | null = null;
  for (const s of samples) {
    if (s.session == null) continue;
    if (last != null && s.session < last) open = out = false;
    if (!open && s.session > 0) {
      open = true;
      opened++;
    }
    if (open && !out && s.session >= 100) {
      out = true;
      ranOut++;
    }
    last = s.session;
  }
  return { opened, ranOut };
}

/** Weekly readings of both accounts on one timeline, one point per reading. */
function weeklyLine(
  claude: UsageSample[],
  codex: UsageSample[],
  from: number,
  to: number,
) {
  const points = [
    ...claude.map((s) => ({ at: s.at, claude: s.weekly, codex: undefined })),
    ...codex.map((s) => ({ at: s.at, claude: undefined, codex: s.weekly })),
  ]
    .filter((p) => p.at >= from && p.at <= to)
    .sort((a, b) => a.at - b.at);
  const line: UsageSummary["weekly"] = [];
  let c: number | null = null;
  let x: number | null = null;
  for (const p of points) {
    if (p.claude !== undefined) c = p.claude;
    if (p.codex !== undefined) x = p.codex;
    line.push({ at: p.at, claude: c, codex: x });
  }
  return line;
}

export function summarizeUsage(
  entries: readonly UsageEntry[],
  input: {
    range: UsageRange;
    now: number;
    chats: UsageChat[];
    limits?: { claude?: UsageSample[]; codex?: UsageSample[] };
  },
): UsageSummary {
  const { range, now } = input;
  const span = SPAN[range];
  const first = entries.reduce((min, e) => Math.min(min, e.at), Infinity);
  const since = Number.isFinite(first) ? first : undefined;
  const today = midnight(now);
  const from =
    span === null
      ? midnight(since ?? now)
      : midnight(today - (span - 1) * DAY + DAY / 2);
  const to = now;

  const days: UsageDay[] = [];
  for (let day = from; day <= today; day = nextDay(day))
    days.push({ day, tokens: perProvider(), usd: perProvider(), answers: 0 });
  const dayOf = (at: number) => {
    const day = midnight(at);
    // Days are few; a binary search would be overkill next to the entries.
    for (let i = days.length - 1; i >= 0; i--)
      if (days[i].day === day) return days[i];
  };

  const harness = new Map<
    AgentProvider,
    { tokens: number; usd: number; answers: number }
  >();
  const models = new Map<string, UsageSummary["models"][number]>();
  const jobs = new Map<
    UsageJob,
    { runs: number; tokens: number; usd: number }
  >();
  const threads = new Map<
    string,
    { tokens: number; usd: number; answers: number; by: PerProvider }
  >();
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const totals = {
    tokens: 0,
    usd: 0,
    answers: 0,
    relayTokens: 0,
    relayUsd: 0,
    agentMs: 0,
  };

  for (const e of entries) {
    if (e.at < from || e.at > to) continue;
    const day = dayOf(e.at);
    let tokens = 0;
    let usd = 0;
    for (const [model, spend] of Object.entries(e.models)) {
      const n = tokenTotal(spend.tokens);
      tokens += n;
      usd += spend.usd ?? 0;
      const key = `${e.provider}|${modelLabel(model)}`;
      const row = models.get(key) ?? {
        model: modelLabel(model),
        provider: e.provider,
        tokens: 0,
        usd: 0,
        answers: 0,
        unpriced: false,
      };
      row.tokens += n;
      row.usd += spend.usd ?? 0;
      if (spend.usd === undefined && n) row.unpriced = true;
      models.set(key, row);
    }
    // A run's answer goes to the model that did most of it.
    if (e.answer) {
      const lead = Object.entries(e.models).sort(
        (a, b) => tokenTotal(b[1].tokens) - tokenTotal(a[1].tokens),
      )[0];
      if (lead) models.get(`${e.provider}|${modelLabel(lead[0])}`)!.answers++;
    }
    const answers = e.answer ? 1 : 0;
    totals.tokens += tokens;
    totals.usd += usd;
    totals.answers += answers;
    totals.agentMs += e.ms;
    if (day) {
      day.tokens[e.provider] += tokens;
      day.usd[e.provider] += usd;
      day.answers += answers;
    }
    const h = harness.get(e.provider) ?? { tokens: 0, usd: 0, answers: 0 };
    h.tokens += tokens;
    h.usd += usd;
    h.answers += answers;
    harness.set(e.provider, h);
    if (e.job !== "thread" && e.job !== "room") {
      totals.relayTokens += tokens;
      totals.relayUsd += usd;
      const j = jobs.get(e.job) ?? { runs: 0, tokens: 0, usd: 0 };
      if (e.answer || e.job === "watch") j.runs++;
      j.tokens += tokens;
      j.usd += usd;
      jobs.set(e.job, j);
    }
    if (e.ms) addHeat(heat, e.at, e.ms);
    if (e.chat && e.job === "thread") {
      const t = threads.get(e.chat) ?? {
        tokens: 0,
        usd: 0,
        answers: 0,
        by: perProvider(),
      };
      t.tokens += tokens;
      t.usd += usd;
      t.answers += answers;
      t.by[e.provider] += tokens;
      threads.set(e.chat, t);
    }
  }

  const chats = new Map(input.chats.map((c) => [c.id, c]));
  const counted = [...threads.values()];
  const started = input.chats.filter(
    (c) => c.created >= from && c.created <= to,
  );
  return {
    range,
    from,
    to,
    since,
    days,
    totals,
    harnesses: agentProviders
      .map((provider) => ({
        provider,
        ...(harness.get(provider) ?? { tokens: 0, usd: 0, answers: 0 }),
      }))
      .filter((h) => h.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens),
    models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
    jobs: [...jobs.entries()]
      .map(([job, j]) => ({ job, ...j }))
      .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens),
    threads: [...threads.entries()]
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5)
      .map(([id, t]) => ({
        chat: id,
        title: chats.get(id)?.title ?? "Deleted thread",
        project: chats.get(id)?.project ?? "",
        provider: agentProviders.reduce((best, p) =>
          t.by[p] > t.by[best] ? p : best,
        ),
        tokens: t.tokens,
        usd: t.usd,
        answers: t.answers,
      })),
    heat: heat.map((row) => row.map(Math.round)),
    weekly: weeklyLine(
      input.limits?.claude ?? [],
      input.limits?.codex ?? [],
      from,
      to,
    ),
    windows: [input.limits?.claude, input.limits?.codex]
      .map((samples) =>
        sessionWindows((samples ?? []).filter((s) => s.at >= from)),
      )
      .reduce((a, b) => ({
        opened: a.opened + b.opened,
        ranOut: a.ranOut + b.ranOut,
      })),
    cards: {
      started: started.length,
      byAgents: started.filter((c) => c.byAgent).length,
      settled: input.chats.filter(
        (c) => c.settledAt && c.settledAt >= from && c.settledAt <= to,
      ).length,
    },
    perThread: {
      tokensAvg: counted.length
        ? counted.reduce((n, t) => n + t.tokens, 0) / counted.length
        : 0,
      tokensMedian: median(counted.map((t) => t.tokens)),
      answersAvg: counted.length
        ? counted.reduce((n, t) => n + t.answers, 0) / counted.length
        : 0,
    },
  };
}
