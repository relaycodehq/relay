// Redacts raw transcripts from record-replays.test.ts into tests/fixtures/replays.
//
//   node tests/record/redact.mjs [raw folder] [agent/scenario …]
//
// Paths, names, emails, keys and account ids become stable placeholders; ids
// the agent made, method names and the order of lines stay as recorded,
// since that order is what the replays test. tests/unit/replay-fixtures.test.ts
// fails on anything this missed.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { accountKeys, accountTier, idKeys, secretKeys } from "./redact-keys.mjs";

const raw = resolve(process.argv[2] ?? "/tmp/relay-replays-raw");
const only = process.argv.slice(3);
const fixtures = resolve("tests/fixtures/replays");
const home = homedir();
const user = userInfo().username;
/** The recording person's name, as git knows it, in words long enough to look for. */
const person = (() => {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" })
      .split(/\s+/)
      .filter((word) => word.length >= 4);
  } catch {
    return [];
  }
})();
// Recording Relay's own checkout (where the model probe runs) shows its path.
const checkout = process.cwd();

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Both spellings of a temp path: macOS lists /var as /private/var. */
const spellings = (path) =>
  path.startsWith("/private/") ? [path, path.slice("/private".length)] : [path, `/private${path}`];

/**
 * What the account itself brings along: claude.ai connectors and skills synced
 * from claude.ai. Dropped from lists, names and all.
 */
function accountItems(value, names = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => accountItems(v, names));
  else if (value && typeof value === "object") {
    if (
      value.source === "claudeai" ||
      (typeof value.description === "string" && value.description.includes("(claude.ai sync)"))
    )
      names.add(value.name);
    Object.values(value).forEach((v) => accountItems(v, names));
  }
  return names;
}
const fromAccount = (v, names) =>
  (v && typeof v === "object" && names.has(v.name)) ||
  (typeof v === "string" &&
    (names.has(v) || names.has(v.split(":").pop()) || v.startsWith("mcp__claude_ai_")));

function scrubValue(key, value, names) {
  if (value === null || value === undefined || value === "") return value;
  if (secretKeys.test(key) && typeof value === "string") return "REDACTED";
  if (idKeys.test(key) && typeof value === "string") return "replay-id";
  if (accountTier(key, value)) return typeof value === "string" ? "replay" : null;
  if (accountKeys.test(key)) return typeof value === "string" ? "replay" : null;
  if (Array.isArray(value))
    return value.filter((v) => !fromAccount(v, names)).map((v) => scrubValue("", v, names));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubValue(k, v, names)]),
    );
  return value;
}

export function redactText(text, { project, root }) {
  let out = text;
  for (const p of spellings(project)) out = out.replaceAll(p, "{{project}}");
  for (const p of spellings(root)) out = out.replaceAll(p, "/tmp/replay");
  out = out.replaceAll(checkout, "/tmp/replay/relay");
  out = out.replace(/\/(private\/)?var\/folders\/[^"\s\\]+/g, "/tmp/replay-temp");
  // The same folders as Claude names its project folders: slashes as dashes.
  out = out.replace(/-(private-)?var-folders-[^"\s\\/]+/g, "-tmp-replay-temp");
  out = out.replaceAll(home, "{{home}}");
  out = out.replaceAll(home.replaceAll("/", "-"), "-home-replay");
  if (user.length >= 5) out = out.replace(new RegExp(`\\b${escape(user)}\\b`, "gi"), "replay");
  out = out.replace(/\b[A-Za-z0-9-]+\.local\b/g, "replay.local");
  for (const name of person)
    out = out.replace(new RegExp(`\\b${escape(name)}\\b`, "giu"), "Replay");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (email) =>
    /@(example\.com|anthropic\.com|openai\.com)$/.test(email) ? email : "replay@example.com",
  );
  out = out
    .replace(/sk-(ant-)?[A-Za-z0-9_-]{16,}/g, "sk-REDACTED")
    .replace(/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/g, "gh-REDACTED")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "jwt-REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/g, "$1REDACTED");
  return out;
}

function redactFile(lines, where) {
  const entries = lines.map((line) => JSON.parse(redactText(line, where)));
  const parsed = entries.map((e) => {
    try {
      return e.line === undefined ? undefined : JSON.parse(e.line);
    } catch {
      // A line that isn't JSON is kept as text, already redacted above.
      return undefined;
    }
  });
  const names = new Set();
  parsed.forEach((m) => accountItems(m, names));
  return entries.map((entry, i) => {
    if (parsed[i] !== undefined) entry.line = JSON.stringify(scrubValue("", parsed[i], names));
    return JSON.stringify(entry);
  });
}

/** A JSON text with its keys scrubbed, or the text as it was. */
function scrubJson(text, names) {
  try {
    return JSON.stringify(scrubValue("", JSON.parse(text), names));
  } catch {
    return text;
  }
}

/** OpenCode's service as the proxy recorded it: bodies and events hold JSON. */
function redactHttp(lines, where) {
  const names = new Set();
  return lines.map((line) => {
    const entry = JSON.parse(redactText(line, where));
    if (typeof entry.body === "string") entry.body = scrubJson(entry.body, names);
    if (typeof entry.data === "string")
      entry.data = entry.data.replace(/^data: (.*)$/gm, (_, json) => `data: ${scrubJson(json, names)}`);
    return JSON.stringify(entry);
  });
}

for (const agent of readdirSync(raw).filter((d) => !d.startsWith("."))) {
  for (const scenario of readdirSync(join(raw, agent))) {
    if (only.length && !only.includes(`${agent}/${scenario}`) && !only.includes(agent)) continue;
    const from = join(raw, agent, scenario);
    if (!statSync(from).isDirectory()) continue;
    const files = readdirSync(from)
      .filter((f) => f.endsWith(".jsonl") && f !== "http.jsonl")
      .sort();
    if (!files.length) continue;
    const to = join(fixtures, agent, scenario);
    rmSync(to, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    const read = files.map((file) =>
      readFileSync(join(from, file), "utf8").split("\n").filter(Boolean),
    );
    // The scenario's sample project, and the temp folder around it that holds
    // the threads and the agent stand-ins.
    const project = read
      .map((lines) => JSON.parse(lines[0]).meta.cwd)
      .find((cwd) => cwd.endsWith("/project"));
    if (!project) throw new Error(`${agent}/${scenario}: no transcript ran in the sample project`);
    const where = { project, root: project.slice(0, -"/project".length) };
    read.forEach((lines, i) =>
      writeFileSync(
        join(to, `${String(i + 1).padStart(2, "0")}.jsonl`),
        redactFile(lines, where).join("\n") + "\n",
      ),
    );
    const http = join(from, "http.jsonl");
    if (statSync(http, { throwIfNoEntry: false }))
      writeFileSync(
        join(to, "http.jsonl"),
        redactHttp(readFileSync(http, "utf8").split("\n").filter(Boolean), where).join("\n") + "\n",
      );
    console.log(`${agent}/${scenario}: ${files.length} transcript(s)`);
  }
}
