// The hosts a user's SSH config names, for the Over SSH field to suggest:
// each `Host` that's a name rather than a pattern, with where it goes, across
// the files its `Include`s pull in.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { SshHost } from "../../shared/handoff";

type Line = { key: string; values: string[] };

/** `Key value…` or `Key=value`, with quoted values and comments as ssh reads them. */
function lines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
    if (!match) continue;
    const values = [...match[2]!.matchAll(/"([^"]*)"|(\S+)/g)].map(
      (m) => m[1] ?? m[2]!,
    );
    out.push({ key: match[1]!.toLowerCase(), values });
  }
  return out;
}

/** A name to connect to, not a pattern (`*.corp`, `!bastion`) that applies to many. */
const isName = (pattern: string) => !/[*?!]/.test(pattern);

/**
 * The hosts in one config's text, in order; `include` reads what an
 * `Include` line names. The first `HostName` and `User` a host gets win, as
 * in ssh.
 */
export async function parseSshConfig(
  text: string,
  include: (pattern: string) => Promise<SshHost[]>,
): Promise<SshHost[]> {
  const hosts: SshHost[] = [];
  let current: SshHost[] = [];
  for (const { key, values } of lines(text)) {
    if (key === "host") {
      current = values.filter(isName).map((host) => ({ host }));
      hosts.push(...current);
    } else if (key === "match") current = [];
    else if (key === "include")
      for (const pattern of values) hosts.push(...(await include(pattern)));
    else if (key === "hostname" && values[0])
      for (const h of current) h.hostName ??= values[0];
    else if (key === "user" && values[0])
      for (const h of current) h.user ??= values[0];
  }
  return hosts;
}

/** The files an `Include` names: relative to ~/.ssh, with `*` in the file name. */
async function includedFiles(pattern: string, sshDir: string) {
  const path = pattern.startsWith("~/")
    ? join(homedir(), pattern.slice(2))
    : isAbsolute(pattern)
      ? pattern
      : join(sshDir, pattern);
  const name = basename(path);
  if (!/[*?]/.test(name)) return [path];
  const glob = new RegExp(
    `^${name
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );
  const dir = dirname(path);
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => glob.test(n))
    .sort()
    .map((n) => join(dir, n));
}

/** The hosts in ~/.ssh/config and what it includes, each name once. */
export async function sshHosts(
  config = join(homedir(), ".ssh", "config"),
): Promise<SshHost[]> {
  const sshDir = dirname(config);
  const seen = new Set<string>();
  const read = async (file: string, depth: number): Promise<SshHost[]> => {
    // ssh stops at 16 levels; a loop would never end.
    if (depth > 16 || seen.has(file)) return [];
    seen.add(file);
    const text = await readFile(file, "utf8").catch(() => "");
    return parseSshConfig(text, async (pattern) =>
      (
        await Promise.all(
          (await includedFiles(pattern, sshDir)).map((f) => read(f, depth + 1)),
        )
      ).flat(),
    );
  };
  const named = new Set<string>();
  return (await read(config, 0)).filter(
    (h) => !named.has(h.host) && !!named.add(h.host),
  );
}
