// What the agents burned, counted on this computer and never sent anywhere.
// Main keeps one line per answer (electron/usage); the Usage page reads the
// summary built here.
import type { AgentProvider } from "./agents";
import { agentProviders } from "./agents";

export type UsageTokens = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

/**
 * What an agent run was for: a thread's own work or one of Relay's jobs.
 * Ledgers written before pull request rooms were removed also hold "room".
 */
export const usageJobs = [
  "thread",
  "title",
  "commit",
  "watch",
  "triage",
  "plugin",
  "helper",
] as const;
export type UsageJob = (typeof usageJobs)[number];

/** Relay's own jobs, by what the page calls them. */
export const relayJobLabels: Record<Exclude<UsageJob, "thread">, string> = {
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

/**
 * What the page counts by: dollars at API list prices, or fresh tokens, the
 * input, cache writes and output without the cache re-reads that make up
 * nearly all of an agent's raw count.
 */
export type UsageMeasure = "usd" | "fresh";

export type UsageDay = {
  /** Local midnight. */
  day: number;
  usd: PerProvider;
  fresh: PerProvider;
  answers: number;
};

/** An hour of the day or a day of the week, summed over the period. */
export type UsageSlot = {
  usd: number;
  fresh: number;
  /** Agent-minutes busy; threads working side by side pass 60 an hour. */
  minutes: number;
  /** How many of this slot the period held, to average by. */
  days: number;
};

export type UsageSummary = {
  range: UsageRange;
  from: number;
  to: number;
  /** The first answer Relay counted, so the page can say how far back it knows. */
  since?: number;
  /** From the later of `from` and the first day counted. */
  days: UsageDay[];
  totals: {
    /** Every token, cache re-reads included. */
    tokens: number;
    fresh: number;
    usd: number;
    /** Some tokens had no list price, so `usd` is short. */
    unpriced: boolean;
    answers: number;
    agentMs: number;
    /** Relay's own jobs: titles, commit messages, watcher checks. */
    relayFresh: number;
    relayUsd: number;
  };
  models: {
    model: string;
    provider: AgentProvider;
    fresh: number;
    usd: number;
    unpriced: boolean;
  }[];
  /** The busiest few by each measure, so either can rank them. */
  threads: {
    chat: string;
    title: string;
    projectId: string;
    project: string;
    provider: AgentProvider;
    fresh: number;
    usd: number;
  }[];
  /** Local hours, midnight first. Spend counts at the hour a run started. */
  hours: UsageSlot[];
  /** Monday first. */
  weekdays: UsageSlot[];
};

/** A thread as the summary needs it. */
export type UsageChat = {
  id: string;
  title: string;
  projectId: string;
  /** The project's name. */
  project: string;
};

const DAY = 24 * 60 * 60_000;
const SPAN: Record<UsageRange, number | null> = {
  "7d": 7,
  "30d": 30,
  all: null,
};

export const tokenTotal = (t: UsageTokens) =>
  t.input + t.cacheWrite + t.cacheRead + t.output;

export const freshTokens = (t: UsageTokens) =>
  t.input + t.cacheWrite + t.output;

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

const slots = (n: number): UsageSlot[] =>
  Array.from({ length: n }, () => ({ usd: 0, fresh: 0, minutes: 0, days: 0 }));

const weekday = (at: number) => (new Date(at).getDay() + 6) % 7;

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

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * "claude-opus-5-5-20260901[1m]" reads "Opus 5.5", "gpt-6.1-sol" reads
 * "GPT-6.1 Sol"; other models keep their id.
 */
export function modelLabel(model: string) {
  const bare = model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(bare);
  if (claude) return `${cap(claude[1])} ${claude[2]}.${claude[3]}`;
  const gpt = /^gpt-(\d+(?:\.\d+)?)((?:-[a-z]+)*)$/.exec(bare);
  if (gpt)
    return [
      `GPT-${gpt[1]}`,
      ...gpt[2].split("-").filter(Boolean).map(cap),
    ].join(" ");
  return bare;
}

/** Busy minutes of a run spread over the hours and days it covered. */
function addBusy(
  hours: UsageSlot[],
  weekdays: UsageSlot[],
  at: number,
  ms: number,
) {
  let t = at;
  const end = at + ms;
  while (t < end) {
    const d = new Date(t);
    const next = new Date(d);
    next.setMinutes(60, 0, 0);
    const stop = Math.min(end, next.getTime());
    const minutes = (stop - t) / 60_000;
    hours[d.getHours()].minutes += minutes;
    weekdays[weekday(t)].minutes += minutes;
    t = stop;
  }
}

export function summarizeUsage(
  entries: readonly UsageEntry[],
  input: { range: UsageRange; now: number; chats: UsageChat[] },
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

  // Days before Relay counted anything would only draw as an empty stretch.
  const days: UsageDay[] = [];
  for (
    let day = Math.max(from, since === undefined ? from : midnight(since));
    day <= today;
    day = nextDay(day)
  )
    days.push({ day, usd: perProvider(), fresh: perProvider(), answers: 0 });
  const dayOf = (at: number) => {
    const day = midnight(at);
    // Days are few; a binary search would be overkill next to the entries.
    for (let i = days.length - 1; i >= 0; i--)
      if (days[i].day === day) return days[i];
  };

  const hours = slots(24);
  const weekdays = slots(7);
  for (const h of hours) h.days = days.length;
  for (const d of days) weekdays[weekday(d.day)].days++;

  const models = new Map<string, UsageSummary["models"][number]>();
  const threads = new Map<
    string,
    { fresh: number; usd: number; by: PerProvider }
  >();
  const totals: UsageSummary["totals"] = {
    tokens: 0,
    fresh: 0,
    usd: 0,
    unpriced: false,
    answers: 0,
    agentMs: 0,
    relayFresh: 0,
    relayUsd: 0,
  };

  for (const e of entries) {
    if (e.at < from || e.at > to) continue;
    let fresh = 0;
    let usd = 0;
    for (const [model, spend] of Object.entries(e.models)) {
      const n = freshTokens(spend.tokens);
      totals.tokens += tokenTotal(spend.tokens);
      fresh += n;
      usd += spend.usd ?? 0;
      const key = `${e.provider}|${modelLabel(model)}`;
      const row = models.get(key) ?? {
        model: modelLabel(model),
        provider: e.provider,
        fresh: 0,
        usd: 0,
        unpriced: false,
      };
      row.fresh += n;
      row.usd += spend.usd ?? 0;
      if (spend.usd === undefined && n) row.unpriced = totals.unpriced = true;
      models.set(key, row);
    }
    totals.fresh += fresh;
    totals.usd += usd;
    totals.agentMs += e.ms;
    if (e.answer) totals.answers++;
    const day = dayOf(e.at);
    if (day) {
      day.fresh[e.provider] += fresh;
      day.usd[e.provider] += usd;
      if (e.answer) day.answers++;
    }
    for (const slot of [
      hours[new Date(e.at).getHours()],
      weekdays[weekday(e.at)],
    ]) {
      slot.fresh += fresh;
      slot.usd += usd;
    }
    if (e.ms) addBusy(hours, weekdays, e.at, e.ms);
    // Old "room" runs still count above, but aren't one of Relay's jobs.
    if (e.job !== "thread" && Object.hasOwn(relayJobLabels, e.job)) {
      totals.relayFresh += fresh;
      totals.relayUsd += usd;
    }
    if (e.chat && e.job === "thread") {
      const t = threads.get(e.chat) ?? { fresh: 0, usd: 0, by: perProvider() };
      t.fresh += fresh;
      t.usd += usd;
      t.by[e.provider] += fresh;
      threads.set(e.chat, t);
    }
  }

  const chats = new Map(input.chats.map((c) => [c.id, c]));
  const counted = [...threads.entries()];
  const busiest = new Set(
    (["usd", "fresh"] as const).flatMap((m) =>
      [...counted]
        .sort((a, b) => b[1][m] - a[1][m])
        .slice(0, 3)
        .map(([id]) => id),
    ),
  );
  return {
    range,
    from,
    to,
    since,
    days,
    totals,
    models: [...models.values()],
    threads: counted
      .filter(([id]) => busiest.has(id))
      .map(([id, t]) => ({
        chat: id,
        title: chats.get(id)?.title ?? "Deleted thread",
        projectId: chats.get(id)?.projectId ?? "",
        project: chats.get(id)?.project ?? "",
        provider: agentProviders.reduce((best, p) =>
          t.by[p] > t.by[best] ? p : best,
        ),
        fresh: t.fresh,
        usd: t.usd,
      })),
    hours,
    weekdays,
  };
}
