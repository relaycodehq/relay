import { deflateSync } from "node:zlib";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../pull-requests/gitea";
import type { SystemInfo } from "./report";
import { BugReports, type BugReportDeps, type DesktopActions } from "./service";
import type { CreatedIssue, Exec, IssueHost } from "./submit";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "relay-report-"));
  mkdirSync(join(root, "logs"));
  writeFileSync(
    join(root, "logs", "main.log"),
    "2026-10-13T10:00:00.000Z warn Could not open /Users/jana/code/app/x.ts\n" +
      "2026-10-13T10:00:01.000Z error token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const system: SystemInfo = {
  version: "1.2.3",
  packaged: true,
  os: "macOS 26.0",
  arch: "arm64",
  translated: false,
  electron: "44.4.2",
  chrome: "140",
  node: "24",
  memoryGb: 32,
  agents: [
    {
      id: "claude",
      name: "Claude Code",
      version: "2.1.0",
      path: "/Users/jana/.local/bin/claude",
      how: "native",
    },
    { id: "amp", name: "Amp", version: null },
  ],
  gh: "2.89.0",
  appPath: "/Applications/Relay.app",
  dataPath: "~/Library/Application Support/Relay",
};

function fakeHost(over: Partial<IssueHost> = {}) {
  const posted: { title: string; body: string }[] = [];
  const host: IssueHost = {
    login: "jana",
    createIssue: vi.fn(async (_repo, title, body) => {
      posted.push({ title, body });
      return { number: 7, url: "https://github.com/o/r/issues/7" };
    }),
    findIssue: vi.fn(async (): Promise<CreatedIssue | null> => null),
    visibility: async () => "public",
    ...over,
  };
  return { host, posted };
}

function service(
  host: IssueHost | (() => Promise<IssueHost>),
  extra: Partial<BugReportDeps> = {},
  desktop?: DesktopActions,
) {
  const deps: BugReportDeps = {
    dir: join(root, "bug-report"),
    logs: join(root, "logs"),
    repo: "o/r",
    system: async () => system,
    identity: () => ({
      home: "/Users/jana",
      user: "jana",
      hosts: [],
      relayData: "/Users/jana/Library/Application Support/Relay",
      projects: [{ path: "/Users/jana/code/app" }],
    }),
    host: typeof host === "function" ? host : async () => host,
    gh: async () => null,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    writeUp: async () => {
      throw new Error("No agent in this test.");
    },
    defaultWriter: () => ({
      provider: "codex",
      choice: { model: "", fast: false, reasoningEffort: "low" },
    }),
    ...extra,
  };
  return new BugReports(deps, desktop);
}

/** A 1×1 PNG with a text chunk holding something private. */
function png() {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("tEXt", Buffer.from("Author\0jana@example.org")),
      chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const fields = {
  title: "Diff pane goes blank",
  description: "Clicked a file, the pane went white.",
  kind: "bug" as const,
  includeLog: true,
  removedFacts: [],
};

it("keeps the draft and its cleaned screenshot across a restart", async () => {
  const first = service(fakeHost().host);
  await first.save(fields);
  const added = await first.addScreenshot("Blank pane", png());
  const [shot] = added.draft.screenshots;
  expect(shot).toMatchObject({ name: "Blank pane", width: 1, height: 1 });

  // A new process reads what the last one wrote.
  const next = service(fakeHost().host);
  const preview = await next.open();
  expect(preview.draft).toMatchObject(fields);
  expect(preview.draft.screenshots).toEqual([shot]);
  const bytes = Buffer.from(await next.screenshotBytes(shot.id));
  expect(bytes.includes("jana@example.org")).toBe(false);
  expect(bytes.includes("IDAT")).toBe(true);
});

it("posts exactly the previewed text, anonymized, and only when asked", async () => {
  const { host, posted } = fakeHost();
  const reports = service(host);
  const preview = await reports.save(fields);
  expect(host.createIssue).not.toHaveBeenCalled();
  expect(preview.body).toContain("<project-1>/x.ts");
  expect(preview.body).toContain("[redacted GitHub token]");
  expect(preview.body).toContain(
    "| Claude Code | `2.1.0 · native · ~/.local/bin/claude` |",
  );
  expect(preview.body).toContain("| Not found | `Amp` |");
  expect(preview.body).not.toMatch(/jana|ghp_/);
  expect(preview.account).toEqual({ login: "jana" });

  const sent = await reports.send(preview.digest);
  expect(posted).toEqual([{ title: preview.title, body: preview.body }]);
  expect(sent.preview.draft.submission).toMatchObject({
    status: "sent",
    url: "https://github.com/o/r/issues/7",
  });
  // Sending again doesn't post again.
  await reports.send(sent.preview.digest);
  expect(posted).toHaveLength(1);
});

it("refuses a send whose preview is stale, and drops what the user took out", async () => {
  const { host } = fakeHost();
  const reports = service(host);
  const old = await reports.save(fields);
  const trimmed = await reports.save({
    ...fields,
    includeLog: false,
    removedFacts: ["agent:claude"],
  });
  expect(trimmed.body).not.toContain("Claude Code");
  expect(trimmed.body).not.toContain("<summary>Log");
  await expect(reports.send(old.digest)).rejects.toThrow(/changed/);
  expect(host.createIssue).not.toHaveBeenCalled();
});

it("without a gh login, Send opens GitHub's form with exactly the preview", async () => {
  const opened: string[] = [];
  const copied: string[] = [];
  const desktop: DesktopActions = {
    openExternal: async (url) => void opened.push(url),
    reveal: () => {},
    offerDrag: () => {},
    copy: (text) => void copied.push(text),
    downloads: join(root, "downloads"),
  };
  const signedOut = service(
    async () => {
      throw new Error("Sign in to GitHub with `gh auth login`");
    },
    {},
    desktop,
  );
  const shown = await signedOut.save({ ...fields, includeLog: false });
  expect(shown.account).toBeNull();
  expect(shown.via).toBe("browser");
  const sent = await signedOut.send(shown.digest);
  expect(sent.opened).toBe("prefilled");
  const link = new URL(opened[0]);
  expect(link.pathname).toBe("/o/r/issues/new");
  expect(link.searchParams.get("title")).toBe(shown.title);
  expect(link.searchParams.get("body")).toBe(shown.body);
  expect(copied).toEqual([]);
  expect(sent.preview.draft.submission?.status).toBe("browser");

  // Too long for a link: the report goes on the clipboard, the form says paste.
  const long = await signedOut.save({
    ...fields,
    description: "It went white. ".repeat(400),
  });
  const again = await signedOut.send(long.digest);
  expect(again.opened).toBe("clipboard");
  expect(copied).toEqual([long.body]);
  expect(new URL(opened[1]).searchParams.get("body")).toMatch(/clipboard/);
});

it("records performance and floats the files GitHub only takes dragged in", async () => {
  const offered: string[][] = [];
  const desktop: DesktopActions = {
    openExternal: async () => {},
    reveal: () => {},
    offerDrag: (files) => void offered.push(files),
    copy: () => {},
    downloads: join(root, "downloads"),
  };
  const reports = service(
    async () => {
      throw new Error("Sign in to GitHub with `gh auth login`");
    },
    {
      performance: {
        facts: async () => [
          {
            id: "perf-others",
            group: "performance",
            label: "Busiest other programs",
            value: "Blender 310% in /Users/jana/render",
          },
        ],
        logText: async () => '{"t":1}\n',
        record: async (dir, anonymize, options) => {
          writeFileSync(join(dir, "performance.zip"), anonymize("/Users/jana"));
          return { at: 1, seconds: options.seconds, bytes: 11 };
        },
      },
    },
    desktop,
  );
  const opened = await reports.open();
  expect(opened.facts.find((f) => f.id === "perf-others")?.value).toBe(
    "Blender 310% in ~/render",
  );
  expect(opened.body).toContain("<summary>Performance</summary>");
  await reports.save({ ...fields, attachPerfLog: true });
  const recorded = await reports.record(30);
  expect(recorded.draft.recording).toMatchObject({ seconds: 30 });
  expect(recorded.dragFiles).toEqual([
    "performance.zip",
    "performance-log.txt",
  ]);
  expect(recorded.body).toMatch(
    /Drag the `performance.zip` and `performance-log.txt` from the window/,
  );
  await reports.send(recorded.digest);
  expect(offered).toHaveLength(1);
  expect(offered[0].map((f) => readFileSync(f, "utf8"))).toEqual([
    "~",
    '{"t":1}\n',
  ]);

  const removed = await reports.removeRecording().catch((e: Error) => e);
  // Sent through the browser isn't locked: GitHub's form may not be submitted.
  expect(removed).not.toBeInstanceOf(Error);
});

/** A recording that runs until stopped, then saves into the folder. */
function stoppableRecording(saved: { at?: number } = {}) {
  return {
    facts: async () => [],
    logText: async () => "",
    record: async (
      dir: string,
      _anonymize: unknown,
      options: { seconds: number },
      signal: AbortSignal,
    ) => {
      await new Promise((stopped) =>
        signal.addEventListener("abort", stopped, { once: true }),
      );
      // Zipping takes a while after the stop.
      await new Promise((later) => setTimeout(later, 20));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "performance.zip"), "zip");
      saved.at = Date.now();
      return { at: 1, seconds: options.seconds, bytes: 3 };
    },
  };
}

it("discards a report only once its recording has stopped saving", async () => {
  const saved: { at?: number } = {};
  const reports = service(fakeHost().host, {
    performance: stoppableRecording(saved),
  });
  await reports.save(fields);
  const recording = reports.record(30);
  await vi.waitFor(async () =>
    expect((await reports.preview()).recordingNow).toBeDefined(),
  );
  const discarded = await reports.discard();
  expect(saved.at).toBeDefined();
  expect(existsSync(join(root, "bug-report"))).toBe(false);
  expect(discarded.draft.recording).toBeUndefined();
  expect(discarded.draft.title).toBe("");
  await recording;
  expect(existsSync(join(root, "bug-report"))).toBe(false);
});

it("tells a page opened during a recording once it's saved", async () => {
  const saved: { at?: number } = {};
  const reports = service(fakeHost().host, {
    performance: stoppableRecording(saved),
  });
  await reports.save(fields);
  const recording = reports.record(30);
  await vi.waitFor(async () =>
    expect((await reports.preview()).recordingNow).toBeDefined(),
  );
  // The page that started it went; another opens and waits.
  const done = reports.recordingDone();
  reports.stopRecording();
  const after = await done;
  expect(saved.at).toBeDefined();
  expect(after.recordingNow).toBeUndefined();
  expect(after.draft.recording).toMatchObject({ seconds: 30 });
  await recording;
  // With none under way it answers at once.
  expect((await reports.recordingDone()).recordingNow).toBeUndefined();
});

it("keeps nothing, and says nothing, when stopped before it recorded", async () => {
  const reports = service(fakeHost().host, {
    performance: {
      ...stoppableRecording(),
      record: async (_dir, _anonymize, _options, signal) => {
        await new Promise((stopped) =>
          signal.addEventListener("abort", stopped, { once: true }),
        );
        signal.throwIfAborted();
        throw new Error("Not reached");
      },
    },
  });
  await reports.save(fields);
  const recording = reports.record(30);
  await vi.waitFor(async () =>
    expect((await reports.preview()).recordingNow).toBeDefined(),
  );
  reports.stopRecording();
  const stopped = await recording;
  expect(stopped.draft.recording).toBeUndefined();
  expect(stopped.recordingNow).toBeUndefined();
  expect(stopped.draft.title).toBe(fields.title);
});

it("keeps the draft when GitHub refuses", async () => {
  const { host } = fakeHost({
    createIssue: vi.fn(async () => {
      throw new ApiError(403, "GitHub is rate limiting requests.");
    }),
  });
  const limited = service(host);
  await limited.save(fields);
  const preview = await limited.open();
  await expect(limited.send(preview.digest)).rejects.toThrow(/rate limiting/);
  const after = await limited.open();
  expect(after.draft).toMatchObject(fields);
  expect(after.draft.submission).toBeUndefined();
  expect(after.draft.error).toMatch(/rate limiting/);
});

it("looks for an issue a dropped send may have made instead of posting twice", async () => {
  let created: CreatedIssue | null = null;
  const { host } = fakeHost({
    createIssue: vi.fn(async () => {
      created = { number: 9, url: "https://github.com/o/r/issues/9" };
      throw new Error("Could not connect to api.github.com.");
    }),
    findIssue: vi.fn(async (_repo, marker) => {
      expect(marker).toMatch(/^<!-- relay-report:[0-9a-f-]{36} -->$/);
      return created;
    }),
  });
  const reports = service(host);
  const preview = await reports.save(fields);
  await expect(reports.send(preview.digest)).rejects.toThrow(
    /may have been created/,
  );
  expect((await reports.open()).draft.submission?.status).toBe("unknown");

  // A restart in between changes nothing: the state is on disk.
  const again = service(host);
  const retried = await again.send((await again.open()).digest);
  expect(host.createIssue).toHaveBeenCalledTimes(1);
  expect(retried.preview.draft.submission).toMatchObject({
    status: "sent",
    url: "https://github.com/o/r/issues/9",
  });
});

it("won't send again when it can't tell whether the last send landed", async () => {
  const { host } = fakeHost({
    createIssue: vi.fn(async () => {
      throw new Error("Request cancelled or timed out. Please retry.");
    }),
    findIssue: vi.fn(async () => {
      throw new Error("Could not connect to api.github.com.");
    }),
  });
  const reports = service(host);
  const preview = await reports.save(fields);
  await expect(reports.send(preview.digest)).rejects.toThrow();
  await expect(reports.send(preview.digest)).rejects.toThrow(
    /didn't send again/,
  );
  expect(host.createIssue).toHaveBeenCalledTimes(1);
});

it("treats gh's issue link as sent even when an upload failed", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (_file, args, { cwd }) => {
    calls.push(args);
    if (args.includes("--help"))
      return {
        code: 0,
        stdout: "  --attach file  Attach an image",
        stderr: "",
      };
    // The screenshot and body gh is given are the stored ones.
    expect(readFileSync(join(cwd, "screenshot-1.png")).length).toBeGreaterThan(
      0,
    );
    const body = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
    expect(body).toContain("![Screenshot 1](./screenshot-1.png)");
    return {
      code: 1,
      stdout: "https://github.com/o/r/issues/12\n",
      stderr: "failed to upload screenshot-1.png",
    };
  };
  const { host } = fakeHost();
  const reports = service(host, { gh: async () => "/usr/bin/gh", exec });
  await reports.save(fields);
  const preview = await reports.addScreenshot("Shot", png());
  expect(preview.via).toBe("gh");
  const sent = await reports.send(preview.digest);
  expect(host.createIssue).not.toHaveBeenCalled();
  expect(calls.at(-1)).toContain("./screenshot-1.png#Screenshot 1");
  expect(sent.preview.draft.submission).toMatchObject({
    status: "sent",
    number: 12,
    screenshots: "partial",
  });
});

it("says screenshots need adding by hand when only the API can post", async () => {
  const { host, posted } = fakeHost();
  const reports = service(host);
  await reports.save(fields);
  const preview = await reports.addScreenshot("Shot", png());
  expect(preview.via).toBe("api");
  expect(preview.body).toContain("A screenshot follows in a comment");
  const sent = await reports.send(preview.digest);
  expect(posted[0].body).toBe(preview.body);
  expect(sent.preview.draft.submission).toMatchObject({
    screenshots: "browser",
  });
});

it("bounds the log in the issue and says how much is in it", async () => {
  const lines = Array.from(
    { length: 4000 },
    (_, i) => `2026-10-13T10:00:00.000Z warn line ${i} ${"z".repeat(40)}`,
  );
  writeFileSync(join(root, "logs", "main.log"), lines.join("\n"));
  const preview = await service(fakeHost().host).open();
  expect(preview.body.length).toBeLessThanOrEqual(60_000);
  expect(preview.log.total).toBe(4000);
  expect(preview.log.included).toBeLessThan(4000);
  expect(preview.body).toContain(
    `newest ${preview.log.included} of 4000 lines`,
  );
  expect(preview.body).toContain("line 3999");
});

it("has the picked agent tidy up the description alone", async () => {
  const writeUp = vi.fn<BugReportDeps["writeUp"]>(async () => ({
    title: "Changes pane goes blank",
    description:
      "**What happened**\n\nOpening the Changes pane shows a white page.",
  }));
  const { host } = fakeHost();
  const reports = service(host, { writeUp });
  const writer = {
    provider: "claude" as const,
    choice: {
      model: "claude-haiku-4-5",
      fast: false,
      reasoningEffort: "low" as const,
    },
  };
  await reports.save({
    ...fields,
    description: "changes pane white again?? had to reload",
    writer,
  });
  const preview = await reports.writeWithAgent();
  // Only the text and what Relay saw: no log, facts or screenshots.
  expect(writeUp).toHaveBeenCalledExactlyOnceWith(
    writer,
    "changes pane white again?? had to reload",
    "bug",
    "",
  );
  expect(preview.draft.title).toBe("Changes pane goes blank");
  expect(preview.body).toContain(
    "Opening the Changes pane shows a white page.",
  );
  expect(host.createIssue).not.toHaveBeenCalled();
});

it("doesn't spend an agent run on an empty description", async () => {
  const writeUp = vi.fn<BugReportDeps["writeUp"]>();
  const reports = service(fakeHost().host, { writeUp });
  await reports.save({ ...fields, description: "  " });
  await expect(reports.writeWithAgent()).rejects.toThrow(/own words/);
  expect(writeUp).not.toHaveBeenCalled();
});

it("keeps what the user wrote, so a tidy-up can be undone", async () => {
  const writeUp = vi.fn<BugReportDeps["writeUp"]>(async () => ({
    title: "Changes pane goes blank",
    description: "**What happened**\n\nThe pane goes white.",
  }));
  const reports = service(fakeHost().host, { writeUp });
  await reports.save({
    ...fields,
    title: "pane broke",
    description: "changes pane white again??",
  });
  const tidied = await reports.writeWithAgent();
  expect(tidied.draft.beforeTidy).toEqual({
    title: "pane broke",
    description: "changes pane white again??",
  });
  // Edits after the tidy-up don't lose the original; undo puts it back.
  await reports.save({
    ...fields,
    description: tidied.draft.description,
    title: "Changes pane goes white",
  });
  const undone = await reports.undoTidy();
  expect(undone.draft).toMatchObject({
    title: "pane broke",
    description: "changes pane white again??",
  });
  expect(undone.draft.beforeTidy).toBeUndefined();
});

it("fills a new report from an agent but never over one being written", async () => {
  const reports = service(fakeHost().host);
  await reports.prefill({
    kind: "bug",
    title: "Diff pane goes blank",
    description: "Clicked a file, the pane went white.",
  });
  const filled = await reports.open();
  expect(filled.title).toBe("Diff pane goes blank");
  expect(filled.draft.includeLog).toBe(true);
  await expect(
    reports.prefill({ kind: "feature", title: "Other", description: "x" }),
  ).rejects.toThrow(/already writing a report/);
  expect((await reports.open()).title).toBe("Diff pane goes blank");
});
