// Keeps each account's usage readings on disk so the week's forecast can
// learn when someone actually works. Nothing is kept until main points it at
// a file.
import { readFile, rename, writeFile } from "node:fs/promises";
import type { ProviderUsage } from "../../shared/provider-usage";
import {
  activeHours,
  addSample,
  type ActiveHours,
  type UsageSample,
} from "../../shared/usage-history";

type Provider = ProviderUsage["provider"];
type History = Partial<Record<Provider, UsageSample[]>>;

let path: string | null = null;
let history: Promise<History> | null = null;
let writing = Promise.resolve();

export function keepUsageHistory(file: string) {
  path = file;
  history = null;
}

function load(): Promise<History> {
  history ??= readFile(path!, "utf8")
    .then((text) => JSON.parse(text) as History)
    .catch(() => ({}));
  return history;
}

/** Adds this reading to the record and returns the learned working hours. */
export async function recordUsage(
  usage: ProviderUsage,
): Promise<ActiveHours | null> {
  if (!path) return null;
  const all = await load();
  const before = all[usage.provider] ?? [];
  const find = (kind: "session" | "weekly") =>
    usage.windows.find((w) => w.kind === kind)?.usedPercent ?? null;
  const samples = usage.windows.length
    ? addSample(before, {
        at: Date.now(),
        session: find("session"),
        weekly: find("weekly"),
      })
    : before;
  if (samples !== before) {
    all[usage.provider] = samples;
    const file = path;
    const text = JSON.stringify(all);
    writing = writing
      .then(async () => {
        await writeFile(`${file}.tmp`, text);
        await rename(`${file}.tmp`, file);
      })
      .catch(() => {});
  }
  return activeHours(samples);
}
