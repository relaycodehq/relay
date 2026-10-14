import { redacted } from "../../shared/redact-secrets";

export interface Identity {
  home: string;
  user: string;
  hosts: string[];
  /** Relay's own data folder, worth naming: most paths in the log are in it. */
  relayData: string;
  /** Project folders and their `owner/name` on a host, each given a numbered placeholder. */
  projects: { path: string; repo?: string }[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A path as it may show up in a log: as is, with the other slashes, or with
 * backslashes doubled inside JSON.
 */
function spellings(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return [
    ...new Set([
      trimmed,
      trimmed.replaceAll("\\", "/"),
      trimmed.replaceAll("/", "\\"),
      trimmed.replaceAll("\\", "\\\\"),
    ]),
  ].filter((s) => s.length > 1);
}

/** Replaces `path` and anything under it, keeping what follows. */
function pathRule(path: string, placeholder: string): [RegExp, string] {
  const alternatives = spellings(path)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  // Windows paths compare without case; the rest are exact.
  const flags = /^[a-z]:/i.test(path) ? "gi" : "g";
  return [
    new RegExp(`(?:${alternatives})(?=$|[\\\\/\\s"'\`:),\\]])`, flags),
    placeholder,
  ];
}

/**
 * Text that leaves this computer, with who and where it came from replaced by
 * stable placeholders: the same folder is the same `<project-2>` throughout,
 * and the part under it stays, so a path is still useful. Secrets go as in
 * redactSecrets. Only covers what Relay knows to look for; whatever the user
 * typed or captured is theirs to review.
 */
export function anonymizer(identity: Identity) {
  const rules: [RegExp, string][] = [];
  // Longest first: a project inside the home folder keeps its own name.
  const paths: [string, string][] = [
    ...identity.projects.map((p, i): [string, string] => [
      p.path,
      `<project-${i + 1}>`,
    ]),
    [identity.relayData, "<relay-data>"],
    [identity.home, "~"],
  ];
  for (const [path, placeholder] of paths
    .filter(([path]) => path.length > 1)
    .sort((a, b) => b[0].length - a[0].length))
    rules.push(pathRule(path, placeholder));
  identity.projects.forEach((p, i) => {
    if (p.repo && p.repo.includes("/"))
      rules.push([
        new RegExp(`\\b${escape(p.repo)}\\b`, "gi"),
        `<repo-${i + 1}>`,
      ]);
  });
  // Hosts first: a computer name often holds the user's name.
  for (const host of [
    ...new Set(identity.hosts.filter((h) => h.length >= 3)),
  ].sort((a, b) => b.length - a.length))
    rules.push([
      // Not \b: a name like "Jana's MacBook Pro" or "Počítač" can start or
      // end in a character \b doesn't count as a word's.
      new RegExp(`(?<![\\w-])${escape(host)}(?:\\.local)?(?![\\w-])`, "giu"),
      "<host>",
    ]);
  // Short names would hit ordinary words.
  if (identity.user.length >= 3)
    rules.push([new RegExp(`\\b${escape(identity.user)}\\b`, "gi"), "<user>"]);
  return (text: string) => {
    // Emails first: a user name inside one would leave the rest behind.
    let out = redacted(text).replace(email, "<email>");
    for (const [pattern, placeholder] of rules)
      out = out.replace(pattern, placeholder);
    return scrubNetwork(out);
  };
}

const email = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

/** Private and tailnet addresses, local host names and query values. */
function scrubNetwork(text: string) {
  return (
    text
      // Private, link-local and Tailscale's 100.64/10; loopback stays.
      .replace(
        /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))(?:\.\d{1,3}){1,2}\b/g,
        (ip) => (ip.split(".").length === 4 ? "<ip>" : ip),
      )
      .replace(
        /\b[\w-]+(?:\.[\w-]+)*\.(?:local|lan|ts\.net|internal|home\.arpa)\b/gi,
        "<host>",
      )
      // Query strings carry tokens, signed links and search terms; keep the keys.
      .replace(
        /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'`<>]*\?)([^\s#"'`<>]+)/gi,
        (_, before: string, query: string) =>
          before +
          query
            .split("&")
            .map((pair) => {
              const eq = pair.indexOf("=");
              return eq < 0 ? pair : `${pair.slice(0, eq)}=…`;
            })
            .join("&"),
      )
  );
}
