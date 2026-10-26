import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LspDiagnosticsEvent,
  LspStatusEvent,
} from "../../shared/language-servers";
import type { Resolution } from "./resolve";
import { LanguageServers, type LanguageServersDeps } from "./service";
import { pathsFor } from "./uri";

const fake = resolve(__dirname, "../../tests/fixtures/fake-lsp-server.mjs");
const WHERE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

let tmp: string;
let root: string;
let outside: string;
let services: LanguageServers[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "relay-lsp-"));
  root = join(tmp, "project");
  outside = join(tmp, "elsewhere.rs");
  await Promise.all([writeFile(outside, "// std"), mkdir(root)]);
});

afterEach(async () => {
  for (const s of services) s.dispose();
  services = [];
  await rm(tmp, { recursive: true, force: true });
});

function setup(
  over: {
    env?: Record<string, string>;
    timing?: LanguageServersDeps["timing"];
    idleMs?: number;
    resolve?: LanguageServersDeps["resolve"];
    roots?: Record<string, string>;
  } = {},
) {
  const log = join(tmp, "log.jsonl");
  const starts = join(tmp, "starts");
  const statuses: LspStatusEvent[] = [];
  const diagnostics: LspDiagnosticsEvent[] = [];
  const env = {
    FAKE_LSP_LOG: log,
    FAKE_LSP_STARTS: starts,
    FAKE_LSP_OUTSIDE: pathsFor().toUri(root, outside),
    ...over.env,
  };
  const launch = async (): Promise<Resolution> => ({
    launch: { command: process.execPath, args: [fake], env, source: "path" },
  });
  const service = new LanguageServers({
    root: async (where) => over.roots?.[where] ?? root,
    resolve: over.resolve ?? launch,
    spawn: (l, cwd) =>
      spawn(l.command, l.args, {
        cwd,
        env: { ...process.env, ...l.env },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    status: (e) => statuses.push(e),
    diagnostics: (e) => diagnostics.push(e),
    version: "test",
    idleMs: over.idleMs,
    timing: {
      settleMs: 30,
      changeMs: 20,
      shutdownMs: 500,
      statusMs: 0,
      ...over.timing,
    },
  });
  services.push(service);
  const received = async (): Promise<any[]> =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const startCount = async () =>
    Number(await readFile(starts, "utf8").catch(() => "0"));
  const states = (where = WHERE) =>
    statuses.filter((s) => s.where === where).map((s) => s.state);
  const ready = (where = WHERE) =>
    vi.waitFor(() => expect(states(where)).toContain("ready"));
  return {
    service,
    statuses,
    diagnostics,
    received,
    startCount,
    states,
    ready,
  };
}

describe("opening files", () => {
  it("starts the server for a file's language, and says nothing for other files", async () => {
    const t = setup();
    expect(await t.service.lspOpen(WHERE, "README.md", "# hi")).toEqual({
      server: null,
      status: null,
    });
    const opened = await t.service.lspOpen(
      WHERE,
      "src/main.rs",
      "fn main() {}",
    );
    expect(opened.server).toBe("rust-analyzer");
    expect(opened.status?.language).toBe("rust");
    await t.ready();
    expect(t.states()).toEqual(["starting", "indexing", "ready"]);
    expect(await t.startCount()).toBe(1);
  });

  it("tells the server the folder, and the text of the open file", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "src/main.rs", "fn main() {}");
    await t.ready();
    const messages = await t.received();
    expect(messages.find((m) => m.initialize)?.initialize).toMatchObject({
      rootUri: pathsFor().toUri(root, root),
      folders: [{ name: "project" }],
    });
    const open = messages.find((m) => m.method === "textDocument/didOpen");
    expect(open.params.textDocument).toMatchObject({
      languageId: "rust",
      version: 1,
      text: "fn main() {}",
      uri: pathsFor().toUri(root, "src/main.rs"),
    });
  });

  it("answers what the server asks of its editor", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "a.rs", "");
    await t.ready();
    await vi.waitFor(async () =>
      expect((await t.received()).filter((m) => m.id >= 1000)).toHaveLength(4),
    );
    const replies = (await t.received())
      .filter((m) => m.id >= 1000)
      .sort((a, b) => a.id - b.id);
    expect(
      replies.map((r) => [r.id, "result" in r ? r.result : r.error.code]),
    ).toEqual([
      [1000, [null, null]],
      [1001, null],
      [1002, null],
      [1003, -32601],
    ]);
  });

  it("shares one server between workspaces on one folder, and gives each folder its own", async () => {
    const other = join(tmp, "other");
    await mkdir(other);
    const t = setup({ roots: { [OTHER]: other } });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await t.service.lspOpen("33333333-3333-3333-3333-333333333333", "b.rs", "");
    await t.ready();
    expect(await t.startCount()).toBe(1);
    await t.service.lspOpen(OTHER, "a.rs", "");
    await vi.waitFor(async () => expect(await t.startCount()).toBe(2));
  });

  it("opens nothing in a folder that is gone", async () => {
    const t = setup({ roots: { [OTHER]: join(tmp, "gone") } });
    expect(await t.service.lspOpen(OTHER, "a.rs", "")).toEqual({
      server: null,
      status: null,
    });
    expect(await t.startCount()).toBe(0);
  });
});

describe("documents", () => {
  it("sends a burst of changes once, with the newest text and a higher version", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "a.rs", "v1");
    await t.ready();
    for (const text of ["v2", "v3", "v4"])
      await t.service.lspChange(WHERE, "a.rs", text);
    await vi.waitFor(async () =>
      expect(
        (await t.received()).filter(
          (m) => m.method === "textDocument/didChange",
        ),
      ).toHaveLength(1),
    );
    const change = (await t.received()).find(
      (m) => m.method === "textDocument/didChange",
    );
    expect(change.params.textDocument.version).toBe(4);
    expect(change.params.contentChanges).toEqual([{ text: "v4" }]);
  });

  it("sends pending changes before a query so the answer fits the text", async () => {
    const t = setup({ timing: { changeMs: 10_000 } });
    await t.service.lspOpen(WHERE, "a.rs", "v1");
    await t.ready();
    await t.service.lspChange(WHERE, "a.rs", "v2");
    await t.service.lspHover(WHERE, "a.rs", 0, 0);
    const order = (await t.received())
      .filter((m) => m.method)
      .map((m) => m.method);
    expect(order.indexOf("textDocument/didChange")).toBeGreaterThan(-1);
    expect(order.indexOf("textDocument/didChange")).toBeLessThan(
      order.indexOf("textDocument/hover"),
    );
  });

  it("passes on a save and a close", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "a.rs", "x");
    await t.ready();
    await t.service.lspSave(WHERE, "a.rs");
    await t.service.lspClose(WHERE, "a.rs");
    await vi.waitFor(async () => {
      const methods = (await t.received()).map((m) => m.method);
      expect(methods).toContain("textDocument/didSave");
      expect(methods).toContain("textDocument/didClose");
    });
  });

  it("keeps a file open while another window has it, and closes a gone window's files", async () => {
    const t = setup();
    const main = {};
    const popped = {};
    const sent = async (method: string) =>
      (await t.received()).filter((m) => m.method === method);
    await t.service.lspOpen(WHERE, "a.rs", "x", main);
    await t.service.lspOpen(WHERE, "a.rs", "x", popped);
    await t.ready();
    await t.service.lspClose(WHERE, "a.rs", main);
    // Only an open file is saved, and the server hears in order: a close would come first.
    await t.service.lspSave(WHERE, "a.rs");
    await vi.waitFor(async () =>
      expect(await sent("textDocument/didSave")).toHaveLength(1),
    );
    expect(await sent("textDocument/didClose")).toHaveLength(0);
    await t.service.release(popped);
    await vi.waitFor(async () =>
      expect(await sent("textDocument/didClose")).toHaveLength(1),
    );
  });

  it("pushes diagnostics as the server reports them, by the path the editor used", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "src/a.rs", "ok\nlet x = ERROR;\n");
    await vi.waitFor(() => expect(t.diagnostics).toHaveLength(1));
    expect(t.diagnostics[0]).toEqual({
      where: WHERE,
      path: "src/a.rs",
      diagnostics: [
        {
          line: 1,
          character: 8,
          endLine: 1,
          endCharacter: 13,
          severity: "error",
          message: "found ERROR",
          source: "fake",
          code: "E1",
        },
      ],
    });
    await t.service.lspChange(WHERE, "src/a.rs", "ok\nfixed\n");
    await vi.waitFor(() => expect(t.diagnostics).toHaveLength(2));
    expect(t.diagnostics[1].diagnostics).toEqual([]);
  });

  it("sends the diagnostics it has again when the file is opened a second time", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "a.rs", "ERROR");
    await vi.waitFor(() => expect(t.diagnostics).toHaveLength(1));
    await t.service.lspOpen(OTHER, "a.rs", "ERROR");
    expect(t.diagnostics.at(-1)).toMatchObject({
      where: OTHER,
      path: "a.rs",
    });
    expect(t.diagnostics.at(-1)!.diagnostics).toHaveLength(1);
  });
});

describe("queries", () => {
  async function opened() {
    const t = setup();
    await t.service.lspOpen(WHERE, "src/a.rs", "let a = 1;\n");
    await t.ready();
    return t;
  }

  it("hover as markdown with its range", async () => {
    const t = await opened();
    expect(await t.service.lspHover(WHERE, "src/a.rs", 3, 7)).toEqual({
      markdown: "hover 3:7",
      range: { line: 3, character: 7, endLine: 3, endCharacter: 10 },
    });
  });

  it("definitions inside the folder by relative path, outside by absolute", async () => {
    const t = await opened();
    expect(await t.service.lspDefinition(WHERE, "src/a.rs", 0, 0)).toEqual([
      {
        path: "src/other.txt",
        outside: false,
        line: 2,
        character: 4,
        endLine: 2,
        endCharacter: 7,
      },
      {
        path: outside,
        outside: true,
        line: 7,
        character: 1,
        endLine: 7,
        endCharacter: 4,
      },
    ]);
  });

  it("reads an outside file only after a result pointed at it", async () => {
    const t = await opened();
    await expect(t.service.lspReadFile(WHERE, outside)).rejects.toThrow(
      /pointed at/,
    );
    await t.service.lspDefinition(WHERE, "src/a.rs", 0, 0);
    expect(await t.service.lspReadFile(WHERE, outside)).toBe("// std");
    await expect(
      t.service.lspReadFile(WHERE, join(tmp, "secret.txt")),
    ).rejects.toThrow(/pointed at/);
  });

  it("references", async () => {
    const t = await opened();
    const refs = await t.service.lspReferences(WHERE, "src/a.rs", 0, 0);
    expect(refs.map((r) => r.path)).toEqual(["src/a.rs", "src/other.txt"]);
  });

  it("completions in the server's order, as plain text", async () => {
    const t = await opened();
    const { items, incomplete } = await t.service.lspCompletion(
      WHERE,
      "src/a.rs",
      0,
      3,
    );
    expect(incomplete).toBe(false);
    expect(items).toEqual([
      {
        label: "alpha",
        kind: "variable",
        insertText: "alpha",
        sortText: "a",
        documentation: "**a**",
      },
      {
        label: "beta",
        kind: "function",
        detail: "fn()",
        insertText: "beta()",
        sortText: "b",
      },
    ]);
  });

  it("symbols of the file, flattened with their container", async () => {
    const t = await opened();
    expect(await t.service.lspDocumentSymbols(WHERE, "src/a.rs")).toEqual([
      {
        name: "Outer",
        kind: "class",
        path: "src/a.rs",
        line: 0,
        character: 6,
        endLine: 9,
        endCharacter: 1,
      },
      {
        name: "inner",
        kind: "method",
        path: "src/a.rs",
        line: 1,
        character: 5,
        endLine: 3,
        endCharacter: 3,
        container: "Outer",
      },
    ]);
  });

  it("symbols of the workspace from every server on the folder", async () => {
    const t = await opened();
    expect(await t.service.lspWorkspaceSymbols(WHERE, "Foo")).toEqual([
      {
        name: "FooThing",
        kind: "function",
        path: outside,
        line: 4,
        character: 0,
      },
    ]);
    expect(await t.service.lspWorkspaceSymbols("nowhere", "Foo")).toEqual([]);
  });

  it("rename edits grouped by file, not applied", async () => {
    const t = await opened();
    const edits = await t.service.lspRename(WHERE, "src/a.rs", 0, 4, "renamed");
    expect(edits).toEqual([
      {
        path: "src/a.rs",
        edits: [
          {
            line: 0,
            character: 0,
            endLine: 0,
            endCharacter: 3,
            newText: "renamed",
          },
        ],
      },
      {
        path: "src/other.txt",
        edits: [
          {
            line: 1,
            character: 1,
            endLine: 1,
            endCharacter: 4,
            newText: "renamed",
          },
        ],
      },
    ]);
  });

  it("formatting with the editor's tab settings", async () => {
    const t = await opened();
    const edits = await t.service.lspFormat(WHERE, "src/a.rs", {
      tabSize: 2,
      insertSpaces: false,
    });
    expect(edits).toMatchObject([{ newText: "fmt2false" }]);
  });

  it("answers empty for a file that isn't open and refuses a rename or format", async () => {
    const t = await opened();
    expect(await t.service.lspHover(WHERE, "src/closed.rs", 0, 0)).toBeNull();
    expect(await t.service.lspDefinition(WHERE, "src/closed.rs", 0, 0)).toEqual(
      [],
    );
    await expect(
      t.service.lspRename(WHERE, "src/closed.rs", 0, 0, "x"),
    ).rejects.toThrow(/Open the file/);
  });

  it("swallows a server's error in a query but passes it on for a rename", async () => {
    const t = await opened();
    expect(await t.service.lspHover(WHERE, "src/a.rs", 999, 0)).toBeNull();
    await expect(
      t.service.lspRename(WHERE, "src/a.rs", 999, 0, "x"),
    ).rejects.toThrow("bad position");
  });

  it("answers empty to queries and says why to a rename when the server failed", async () => {
    const t = setup({
      env: { FAKE_LSP_BAD_INIT: "1" },
      timing: { restartDelays: [] },
    });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await vi.waitFor(() => expect(t.states()).toContain("failed"));
    expect(await t.service.lspHover(WHERE, "a.rs", 0, 0)).toBeNull();
    await expect(t.service.lspRename(WHERE, "a.rs", 0, 0, "x")).rejects.toThrow(
      /no thanks/,
    );
  });
});

describe("usages in a folder of several TypeScript projects", () => {
  async function solution() {
    const files = {
      "tsconfig.json": { files: [], references: [{ path: "./web.json" }, { path: "./node.json" }] },
      "web.json": { include: ["src", "shared"] },
      "node.json": { include: ["electron", "shared"] },
    };
    await Promise.all(["src", "shared", "electron"].map((d) => mkdir(join(root, d))));
    await Promise.all([
      ...Object.entries(files).map(([name, config]) => writeFile(join(root, name), JSON.stringify(config))),
      writeFile(join(root, "src/app.ts"), "app"),
      writeFile(join(root, "shared/a.ts"), "a"),
      writeFile(join(root, "electron/main.ts"), "main"),
    ]);
  }

  const uris = async (t: ReturnType<typeof setup>, method: string) =>
    (await t.received()).filter((m) => m.method === method).map((m) => m.params.textDocument.uri);

  it("opens a file of each project once before looking, and closes them with the last open file", async () => {
    await solution();
    const t = setup({ idleMs: 60 });
    await t.service.lspOpen(WHERE, "shared/a.ts", "a");
    await t.ready();
    await t.service.lspReferences(WHERE, "shared/a.ts", 0, 0);
    await t.service.lspReferences(WHERE, "shared/a.ts", 0, 0);
    const files = ["shared/a.ts", "src/app.ts", "electron/main.ts"].map((f) => pathsFor().toUri(root, f));
    // The projects' files open side by side, in whichever order they're read.
    expect((await uris(t, "textDocument/didOpen")).sort()).toEqual([...files].sort());
    const loads = t.statuses.filter((s) => s.message?.startsWith("Loading projects"));
    expect(loads.map((s) => [s.state, s.message, s.progress])).toEqual([
      ["indexing", "Loading projects 1 of 2", 0],
      ["indexing", "Loading projects 2 of 2", 50],
    ]);
    expect(t.statuses.at(-1)?.state).toBe("ready");

    await t.service.lspClose(WHERE, "shared/a.ts");
    await vi.waitFor(() => expect(t.states()).toContain("stopped"));
    expect((await uris(t, "textDocument/didClose")).sort()).toEqual([...files].sort());
  });

  it("keeps a held file open when the editor closes it while another file is open", async () => {
    await solution();
    const t = setup();
    await t.service.lspOpen(WHERE, "shared/a.ts", "a");
    await t.service.lspOpen(WHERE, "src/app.ts", "app");
    await t.ready();
    await t.service.lspReferences(WHERE, "shared/a.ts", 0, 0);
    await t.service.lspClose(WHERE, "src/app.ts");
    expect(await uris(t, "textDocument/didClose")).toEqual([]);
  });
});

describe("progress", () => {
  it("reads indexing from the server's progress, with its percentage", async () => {
    const t = setup({
      env: { FAKE_LSP_PROGRESS: "250" },
      timing: { settleMs: 10 },
    });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await vi.waitFor(() =>
      expect(
        t.statuses.some(
          (s) => s.state === "indexing" && s.message === "Indexing",
        ),
      ).toBe(true),
    );
    expect(t.statuses.find((s) => s.message === "Indexing")).toMatchObject({
      progress: 10,
      server: "rust-analyzer",
    });
    await t.ready();
    expect((await t.service.lspStatus(WHERE))[0]).toMatchObject({
      state: "ready",
    });
  });
});

describe("a folder reached through a link", () => {
  it("counts files the server names by their real path as inside it", async () => {
    const real = join(tmp, "real");
    const link = join(tmp, "link");
    await mkdir(join(real, "src"), { recursive: true });
    await symlink(real, link);
    const t = setup({
      env: { FAKE_LSP_REAL: "1" },
      roots: { [WHERE]: link },
    });
    await t.service.lspOpen(WHERE, "src/a.rs", "ERROR");
    await t.ready();
    await vi.waitFor(() => expect(t.diagnostics).toHaveLength(1));
    expect(t.diagnostics[0].path).toBe("src/a.rs");
    const definitions = await t.service.lspDefinition(WHERE, "src/a.rs", 0, 0);
    expect(definitions.map((d) => [d.path, d.outside])).toEqual([
      ["src/other.txt", false],
      [outside, true],
    ]);
    const edits = await t.service.lspRename(WHERE, "src/a.rs", 0, 0, "x");
    expect(edits.map((f) => f.path)).toEqual(["src/a.rs", "src/other.txt"]);
  });
});

describe("status updates", () => {
  it("reports a state change at once but a burst of progress only now and then", async () => {
    const t = setup({
      env: { FAKE_LSP_REPORTS: "200" },
      timing: { statusMs: 150, settleMs: 5000 },
    });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await vi.waitFor(() =>
      expect(t.statuses.at(-1)).toMatchObject({ progress: 200 }),
    );
    const indexing = t.statuses.filter((s) => s.state === "indexing");
    expect(indexing.length).toBeLessThan(10);
    expect(indexing.at(-1)).toMatchObject({
      message: "Counting: file 200",
      progress: 200,
    });
  });
});

describe("idle and quitting", () => {
  it("stops the server a while after the last file closes, and starts it again for the next", async () => {
    const t = setup({ idleMs: 60 });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await t.service.lspOpen(WHERE, "b.rs", "");
    await t.ready();
    await t.service.lspClose(WHERE, "a.rs");
    await new Promise((r) => setTimeout(r, 150));
    // b is still open.
    expect(t.states()).not.toContain("stopped");
    await t.service.lspClose(WHERE, "b.rs");
    await vi.waitFor(() => expect(t.states()).toContain("stopped"));
    const pid = (await t.received()).find((m) => m.initialize)!.initialize.pid;
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    expect(await t.service.lspStatus(WHERE)).toMatchObject([
      { state: "stopped" },
    ]);

    await t.service.lspOpen(WHERE, "a.rs", "");
    await vi.waitFor(async () => expect(await t.startCount()).toBe(2));
  });

  it("a file opened again before the idle time keeps it running", async () => {
    const t = setup({ idleMs: 80 });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await t.ready();
    await t.service.lspClose(WHERE, "a.rs");
    await new Promise((r) => setTimeout(r, 30));
    await t.service.lspOpen(WHERE, "a.rs", "");
    await new Promise((r) => setTimeout(r, 200));
    expect(t.states()).not.toContain("stopped");
    expect(await t.startCount()).toBe(1);
  });

  it("dispose kills every server at once", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "a.rs", "");
    await t.ready();
    const pid = (await t.received()).find((m) => m.initialize)!.initialize.pid;
    t.service.dispose();
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  });
});

describe("crashes", () => {
  it("restarts a server that died and gives it the open files again", async () => {
    const t = setup({
      env: { FAKE_LSP_CRASH_STARTS: "1" },
      timing: { restartDelays: [10, 10, 10] },
    });
    await t.service.lspOpen(WHERE, "a.rs", "first text");
    await vi.waitFor(async () => {
      expect(t.states().filter((s) => s === "ready")).toHaveLength(1);
    });
    expect(t.statuses.some((s) => s.message === "Restarting…")).toBe(true);
    expect(await t.startCount()).toBe(2);
    const opens = (await t.received()).filter(
      (m) => m.method === "textDocument/didOpen",
    );
    expect(opens.map((m) => m.params.textDocument.text)).toEqual([
      "first text",
      "first text",
    ]);
    // And it answers.
    expect(await t.service.lspHover(WHERE, "a.rs", 0, 0)).not.toBeNull();
  });

  it("keeps the latest text across a restart", async () => {
    const t = setup({
      env: { FAKE_LSP_CRASH_STARTS: "1" },
      timing: { restartDelays: [200], changeMs: 5 },
    });
    await t.service.lspOpen(WHERE, "a.rs", "old");
    await vi.waitFor(() => expect(t.states()).toContain("starting"));
    await vi.waitFor(async () => expect(await t.startCount()).toBe(1));
    await t.service.lspChange(WHERE, "a.rs", "new while down");
    await vi.waitFor(async () => expect(await t.startCount()).toBe(2));
    await t.ready();
    const opens = (await t.received()).filter(
      (m) => m.method === "textDocument/didOpen",
    );
    expect(opens.at(-1).params.textDocument).toMatchObject({
      text: "new while down",
      version: 2,
    });
  });

  it("gives up after the restarts it is allowed, saying why", async () => {
    const t = setup({
      env: { FAKE_LSP_CRASH_STARTS: "99" },
      timing: { restartDelays: [5, 5] },
    });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await vi.waitFor(() => expect(t.states()).toContain("failed"));
    // The first start and two restarts.
    expect(await t.startCount()).toBe(3);
    const failed = t.statuses.find((s) => s.state === "failed")!;
    expect(failed.message).toMatch(/rust-analyzer exited \(3\)/);
    await new Promise((r) => setTimeout(r, 100));
    expect(await t.startCount()).toBe(3);
  });

  it("a server that stayed up long enough starts the count again", async () => {
    const t = setup({
      env: { FAKE_LSP_CRASH_STARTS: "3" },
      timing: { restartDelays: [5, 5], stableMs: 0, settleMs: 100 },
    });
    await t.service.lspOpen(WHERE, "a.rs", "");
    // Three crashes would be two restarts too many without the reset.
    await vi.waitFor(() => expect(t.states()).toContain("ready"));
    expect(t.states()).not.toContain("failed");
    expect(await t.startCount()).toBe(4);
  });

  it("tries a failed server again on the next open, but not at once", async () => {
    const t = setup({
      env: { FAKE_LSP_CRASH_STARTS: "99" },
      timing: { restartDelays: [], retryMs: 150 },
    });
    await t.service.lspOpen(WHERE, "a.rs", "");
    await vi.waitFor(() => expect(t.states()).toContain("failed"));
    expect(await t.startCount()).toBe(1);
    await t.service.lspOpen(WHERE, "b.rs", "");
    expect(await t.startCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    await t.service.lspOpen(WHERE, "c.rs", "");
    await vi.waitFor(async () => expect(await t.startCount()).toBe(2));
  });
});

describe("finding the server", () => {
  it("reports missing with the hint, and asks again only after the retry time", async () => {
    const resolveServer = vi.fn(async (): Promise<Resolution> => ({
      missing: "Install Go.",
    }));
    const t = setup({ resolve: resolveServer, timing: { retryMs: 100 } });
    const opened = await t.service.lspOpen(WHERE, "main.go", "package main");
    expect(opened).toEqual({
      server: "gopls",
      status: {
        server: "gopls",
        language: "go",
        state: "missing",
        message: "Install Go.",
      },
    });
    expect(await t.service.lspHover(WHERE, "main.go", 0, 0)).toBeNull();
    await t.service.lspOpen(WHERE, "other.go", "");
    expect(resolveServer).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 130));
    await t.service.lspOpen(WHERE, "third.go", "");
    expect(resolveServer).toHaveBeenCalledTimes(2);
  });

  it("returns while a download is under way, with its progress as events", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const t = setup({
      resolve: async (_spec, hooks) => {
        hooks.downloading();
        hooks.progress(40, 100);
        await gate;
        hooks.progress(100, 100);
        return {
          launch: {
            command: process.execPath,
            args: [fake],
            env: { FAKE_LSP_LOG: join(tmp, "log.jsonl") },
            source: "downloaded",
          },
        };
      },
    });
    const opened = await t.service.lspOpen(WHERE, "a.rs", "");
    expect(opened.status).toMatchObject({ state: "downloading", progress: 40 });
    expect(await t.service.lspHover(WHERE, "a.rs", 0, 0)).toBeNull();
    finish();
    await t.ready();
    expect(
      t.statuses
        .filter((s) => s.state === "downloading")
        .map((s) => s.progress),
    ).toEqual([0, 40, 100]);
  });

  it("fails with the reason when the download fails", async () => {
    const t = setup({
      resolve: async () => {
        throw new Error("GitHub answered 500.");
      },
    });
    const opened = await t.service.lspOpen(WHERE, "a.rs", "");
    expect(opened.status).toMatchObject({
      state: "failed",
      message: "GitHub answered 500.",
    });
  });

  it("tells a workspace that joins a running server where it stands", async () => {
    const t = setup();
    await t.service.lspOpen(WHERE, "a.rs", "");
    await t.ready();
    await t.service.lspOpen(OTHER, "a.rs", "");
    expect(t.statuses.filter((s) => s.where === OTHER).at(0)).toMatchObject({
      state: "ready",
    });
  });
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
