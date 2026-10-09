import { compareVersions } from "../../shared/agent-updates";

const day = 24 * 60 * 60 * 1000;
const stable = /^\d+\.\d+\.\d+$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** When each release a package may still install came out, by version. */
export type ReleaseTimes = Record<string, number>;

/** Publish times from a full npm packument, leaving out deprecated releases. */
export function releaseTimes(packument: unknown): ReleaseTimes {
  if (!isRecord(packument) || !isRecord(packument.time)) return {};
  const versions = isRecord(packument.versions) ? packument.versions : {};
  const times: ReleaseTimes = {};
  for (const [version, at] of Object.entries(packument.time)) {
    const manifest = versions[version];
    if (typeof at !== "string" || !isRecord(manifest) || manifest.deprecated)
      continue;
    const ms = Date.parse(at);
    if (!Number.isNaN(ms)) times[version] = ms;
  }
  return times;
}

/**
 * What npm installs when its `min-release-age` holds back releases younger
 * than `days`: the tagged one once it's old enough, else the newest older
 * stable release up to it, which is what `npm install pkg@tag` falls back
 * to. A package that only ships prereleases, as Amp does, falls back to its
 * newest old-enough prerelease, which npm installs only asked for by number.
 * `held` is the tagged release npm skips, and when it stops skipping it.
 */
export function releasedBy(
  times: ReleaseTimes,
  tagged: string,
  days: number,
  now = Date.now(),
): { version?: string; held?: { version: string; until: number } } {
  const at = times[tagged];
  if (at === undefined || at <= now - days * day) return { version: tagged };
  const cutoff = now - days * day;
  const version = Object.keys(times)
    .filter(
      (v) =>
        (stable.test(v) || !stable.test(tagged)) &&
        times[v] <= cutoff &&
        compareVersions(v, tagged) <= 0,
    )
    .sort(compareVersions)
    .at(-1);
  return { version, held: { version: tagged, until: at + days * day } };
}
