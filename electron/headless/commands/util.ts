import { homedir } from "node:os";
import { sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { agentInfo, type AgentProvider } from "../../../shared/agents";
import { dim } from "../format";

// Small helpers the commands share.

/** This bundle; the service and background starts run it again. */
export const script = __filename;

export const minimumNode = 22;

/** The desktop app's bundle id, which `relay <folder>` opens on macOS. */
export const desktopAppId = "dev.relay.experimental";

/** An error already explained on the terminal. */
export class Quiet extends Error {}

// ── Projects, threads, devices ─────────────────────────────────────────

/** The one item `query` names by id, id prefix or name; anything else is an error listing the choices. */
export function pick<T>(
  items: T[],
  query: string,
  keys: (item: T) => string[],
  what: string,
): T {
  const q = query.toLowerCase();
  const exact = items.filter((i) => keys(i).some((k) => k.toLowerCase() === q));
  if (exact.length === 1) return exact[0]!;
  const loose = items.filter((i) =>
    keys(i).some((k, n) =>
      n === 0 ? k.startsWith(q) : k.toLowerCase().includes(q),
    ),
  );
  if (loose.length === 1) return loose[0]!;
  const names = (loose.length ? loose : items)
    .map((i) => keys(i)[1])
    .join(", ");
  throw new Error(
    loose.length
      ? `More than one ${what} matches “${query}”: ${names}.`
      : `No ${what} matches “${query}”.${names ? ` There's ${names}.` : ""}`,
  );
}

export async function confirm(question: string) {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(`${question} ${dim("[y/N]")} `);
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    prompt.close();
  }
}

/** A path under the home folder as ~/…, as people type it. */
export function tilde(path: string) {
  const home = homedir();
  return path === home || path.startsWith(home + sep)
    ? `~${path.slice(home.length)}`
    : path;
}

export function signIn(provider: AgentProvider) {
  const info = agentInfo(provider);
  return "login" in info ? `${provider} ${info.login}` : provider;
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
