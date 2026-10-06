import { appendFile, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  claudeTurns,
  writeClaudeSession,
  writeCodexSession,
} from "../../tests/fixtures/terminal-sessions";
import { claudeSummary } from "./claude";
import { TerminalSessions, type SessionHome } from "./index";

vi.mock("./claude", async (actual) => {
  const real = await actual<typeof import("./claude")>();
  return { ...real, claudeSummary: vi.fn(real.claudeSummary) };
});

let dir: string, repo: string, claude: string, codex: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-terminal-")));
  repo = join(dir, "repo");
  claude = join(dir, "claude");
  codex = join(dir, "codex");
  await mkdir(repo);
  vi.mocked(claudeSummary).mockClear();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const homes = (extra: SessionHome[] = []) => async () => [
  { provider: "claude" as const, account: "default", home: claude },
  { provider: "codex" as const, account: "default", home: codex },
  ...extra,
];
const turns = [{ prompt: "Fix the cache guard", answer: "Fixed." }];
const HOUR = 3_600_000;

it("lists the folder's terminal sessions only, newest first", async () => {
  await writeClaudeSession(claude, repo, "c-terminal-1", claudeTurns(turns), { ago: 2 * HOUR });
  await writeClaudeSession(claude, repo, "c-relay-0001", claudeTurns(turns), {
    entrypoint: "sdk-cli",
  });
  await writeClaudeSession(claude, join(repo, "src"), "c-subdir-01", claudeTurns(turns));
  await writeCodexSession(codex, repo, "x-terminal-1", turns, { ago: HOUR });
  await writeCodexSession(codex, repo, "x-relay-0001", turns, {
    source: "vscode",
    originator: "relay",
  });
  await writeCodexSession(codex, join(dir, "other"), "x-other-001", turns);

  const rows = await new TerminalSessions(homes()).list(repo);
  expect(rows.map((r) => [r.provider, r.id])).toEqual([
    ["codex", "x-terminal-1"],
    ["claude", "c-terminal-1"],
  ]);
  expect(rows[1]).toMatchObject({
    title: "Fix the cache guard",
    turns: 1,
    account: "default",
    live: false,
  });
});

it("finds sessions from the folder's real path when it's opened through a link", async () => {
  const link = join(dir, "link");
  await symlink(repo, link);
  await writeClaudeSession(claude, repo, "c-terminal-1", claudeTurns(turns));
  expect((await new TerminalSessions(homes()).list(link)).map((r) => r.id)).toEqual([
    "c-terminal-1",
  ]);
});

it("names a session by its title, then Claude's, then its first prompt", async () => {
  const path = await writeClaudeSession(claude, repo, "c-terminal-1", claudeTurns(turns));
  const sessions = new TerminalSessions(homes());
  expect((await sessions.list(repo))[0]!.title).toBe("Fix the cache guard");
  await appendFile(path, JSON.stringify({ type: "ai-title", aiTitle: "Cache guard fix" }) + "\n");
  expect((await sessions.list(repo))[0]!.title).toBe("Cache guard fix");
  await appendFile(path, JSON.stringify({ type: "custom-title", customTitle: "Mine" }) + "\n");
  expect((await sessions.list(repo))[0]!.title).toBe("Mine");

  await writeCodexSession(codex, repo, "x-terminal-1", turns, { name: "Named in Codex" });
  expect((await sessions.list(repo)).find((r) => r.provider === "codex")?.title).toBe(
    "Named in Codex",
  );
});

it("reads a linked account folder once, as Default's; an account's own folder is its own", async () => {
  // Relay's account folders link projects/ back to the usual home.
  const linked = join(dir, "profile-work");
  await mkdir(linked);
  await mkdir(join(claude, "projects"), { recursive: true });
  await symlink(join(claude, "projects"), join(linked, "projects"));
  const own = join(dir, "profile-own");
  await writeClaudeSession(claude, repo, "c-shared-01", claudeTurns(turns));
  await writeClaudeSession(own, repo, "c-own-00001", claudeTurns(turns));
  const rows = await new TerminalSessions(
    homes([
      { provider: "claude", account: "work", home: linked },
      { provider: "claude", account: "own", home: own },
    ]),
  ).list(repo);
  expect(rows.map((r) => [r.id, r.account]).sort()).toEqual([
    ["c-own-00001", "own"],
    ["c-shared-01", "default"],
  ]);
});

it("calls a session changed in the last minute live", async () => {
  await writeClaudeSession(claude, repo, "c-terminal-1", claudeTurns(turns), { ago: 30_000 });
  await writeCodexSession(codex, repo, "x-terminal-1", turns, { ago: 90_000 });
  const rows = await new TerminalSessions(homes()).list(repo);
  expect(Object.fromEntries(rows.map((r) => [r.id, r.live]))).toEqual({
    "c-terminal-1": true,
    "x-terminal-1": false,
  });
});

it("calls a quiet Claude session live while a running claude lists it", async () => {
  await writeClaudeSession(claude, repo, "c-held-0001", claudeTurns(turns), { ago: HOUR });
  await writeClaudeSession(claude, repo, "c-closed-01", claudeTurns(turns), { ago: HOUR });
  // Codex lists nothing of the sort.
  await writeCodexSession(codex, repo, "c-held-0001", turns, { ago: HOUR });
  const asked: string[][] = [];
  const sessions = new TerminalSessions(homes(), undefined, async (dirs) => {
    asked.push(dirs);
    return new Set(["c-held-0001"]);
  });
  const rows = await sessions.list(repo);
  expect(rows.map((r) => [r.provider, r.id, r.live]).sort()).toEqual([
    ["claude", "c-closed-01", false],
    ["claude", "c-held-0001", true],
    ["codex", "c-held-0001", false],
  ]);
  expect(asked).toEqual([[claude]]);
  expect(
    await sessions.find(repo, { provider: "claude", session: "c-held-0001" }),
  ).toMatchObject({ live: true });
});

it("lists terminal sessions behind hundreds of newer Relay ones, reading only the rows it shows", async () => {
  for (let i = 0; i < 320; i++)
    await writeClaudeSession(claude, repo, `c-relay-${String(i).padStart(4, "0")}`, claudeTurns(turns), {
      entrypoint: "sdk-cli",
      ago: 60_000 + i * 1000,
    });
  for (let i = 0; i < 35; i++)
    await writeClaudeSession(claude, repo, `c-term-${String(i).padStart(4, "0")}`, claudeTurns(turns), {
      ago: HOUR + i * 1000,
    });
  const rows = await new TerminalSessions(homes()).list(repo);
  expect(rows.map((r) => r.id)).toEqual(
    Array.from({ length: 30 }, (_, i) => `c-term-${String(i).padStart(4, "0")}`),
  );
  expect(vi.mocked(claudeSummary)).toHaveBeenCalledTimes(30);
}, 20000);

it("finds a picked session again by id, only in the project's folder", async () => {
  await writeClaudeSession(claude, repo, "c-terminal-1", claudeTurns(turns));
  await writeClaudeSession(claude, join(dir, "other"), "c-elsewhere", claudeTurns(turns));
  await writeCodexSession(codex, repo, "x-terminal-1", turns);
  const sessions = new TerminalSessions(homes());
  expect(
    await sessions.find(repo, { provider: "claude", session: "c-terminal-1" }),
  ).toMatchObject({ provider: "claude", id: "c-terminal-1", account: "default" });
  expect(
    await sessions.find(repo, { provider: "codex", session: "x-terminal-1" }),
  ).toMatchObject({ provider: "codex", id: "x-terminal-1" });
  expect(
    await sessions.find(repo, { provider: "claude", session: "c-elsewhere" }),
  ).toBeUndefined();
  expect(
    await sessions.find(repo, { provider: "codex", session: "c-terminal-1" }),
  ).toBeUndefined();
});
