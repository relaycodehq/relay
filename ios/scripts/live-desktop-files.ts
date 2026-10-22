// The stand-in desktop's files, tasks, working tree, notes, watch notes and updater, for
// the iPhone's Files, Tasks, project screen, notes sheet and Settings (see live-desktop.ts).
// The relay project's files are this checkout's own, as git lists them; the site's are
// previews/website's.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type Thread = { summary: any; messages: any[] };

export function filesFixture(ctx: {
  seeded: boolean;
  root: string;
  now: number;
  min: number;
  relay: string;
  site: string;
  bridge: number;
  threads: Map<string, Thread>;
  thread: (projectId: string, title: string, ago: number, messages: any[], extra?: object) => string;
  message: (role: "user" | "assistant", body: string, ago: number, extra?: object) => any;
  step: (label: string, kind?: string, extra?: object) => any;
  devTask: any;
  changed: (projectId: string) => void;
}) {
  const { root, now, min, relay, site, threads } = ctx;
  const listed = (dir?: string) =>
    execFileSync("git", ["ls-files", ...(dir ? [dir] : [])], { cwd: root, encoding: "utf8", maxBuffer: 32 << 20 })
      .split("\n")
      .filter(Boolean)
      .map((p) => (dir ? p.slice(dir.length + 1) : p));
  const trees: Record<string, { files: string[]; base: string }> = {
    [relay]: { files: listed(), base: root },
    [site]: { files: listed("previews/website"), base: join(root, "previews/website") },
  };
  /** `projectId` or `projectId/chatId`, as the bridge's file calls take it. */
  const treeOf = (where: string) => {
    const tree = trees[where.split("/")[0]];
    if (!tree) throw new Error("This folder isn't a git checkout.");
    return tree;
  };
  const branchOf = (where: string) => {
    const [projectId, chatId] = where.split("/");
    if (chatId) return threads.get(chatId)?.summary.branch ?? "relay/worktree";
    return projectId === site ? "main" : "ios-app";
  };

  // Dev servers and processes: the real dev server, an agent's test watcher in a worktree
  // and a terminal's type checker.
  const swift = [...threads.entries()].find(([, t]) => t.summary.title === "Port the bridge to Swift")?.[0];
  const tasks: Record<string, any[]> = {
    // The "api" project on thinkcenter: a dev server there, which no tunnel to here reaches.
    "88888888-8888-4888-8888-888888888881": [
      { id: "api-dev", command: "npm run dev", kind: "server", title: "Vite dev server", origin: "detached", started: now - 12 * min, ports: [5173], pids: 1 },
    ],
    [relay]: [
      ctx.devTask,
      {
        id: "vitest-watch",
        command: "npx vitest --watch src/features/thread",
        kind: "test",
        title: "Vitest (watch)",
        agent: "claude",
        origin: "relay",
        ...(swift ? { chatId: swift } : {}),
        worktree: "/tmp/relay-worktrees/ios-app",
        started: now - 42 * min,
        ports: [],
        pids: 3,
      },
      {
        id: "tsc-watch",
        command: "npx tsc --noEmit --watch -p tsconfig.renderer.json",
        kind: "build",
        title: "Type check (watch)",
        origin: "terminal",
        started: now - 3 * 60 * min,
        ports: [],
        pids: 1,
      },
    ],
  };

  // A thread whose answer names files, a folder and a changed file, with a note the side check flagged.
  const notesFor = new Map<string, any[]>();
  let filesChat: string | undefined;
  if (ctx.seeded) {
    const asked = ctx.message("user", "Where does the phone decode the bridge's frames?", 9);
    const answer = ctx.message(
      "assistant",
      `It's in \`ios/RelayKit/Sources/RelayRemote/Wire/Wire.swift\`: frames come off the socket in [RemoteClient.swift](ios/RelayKit/Sources/RelayRemote/Client/RemoteClient.swift#L132) and are opened by \`ios/RelayKit/Sources/RelayRemote/Crypto/Channel.swift:40\`.

The Android side mirrors it under \`android/app/src/main/java/dev/relay/android/remote/\`. I touched \`src/styles.css\` too, to step the spinner.

\`\`\`swift
public func call(_ method: String, _ args: [JSON?] = []) async throws -> JSON {
    // Nils go as JSON null.
    let wait = Bridge.slowRemoteMethods.contains(method) ? options.slowTimeout : options.timeout
    return try await request(method, .array(args.map { $0 ?? .null }), wait)
}
\`\`\``,
      8,
      {
        ended: now - 8 * min,
        trace: [ctx.step("ios/RelayKit/Sources/RelayRemote/Wire/Wire.swift", "read")].map((a) => ({ kind: "activity", id: a.id, activity: a })),
        changes: [{ path: "src/styles.css", additions: 4, deletions: 1 }],
        notes: [
          {
            id: "w1",
            tag: "Heads up",
            line: "It changed src/styles.css without running the e2e scroll test.",
            title: "The thread-scroll spec covers this",
            points: ["AGENTS.md asks for `tests/e2e/thread-scroll.spec.ts` after touching the end of the thread.", "The release CI runs only unit tests."],
            diff: { file: "src/styles.css", lines: ["-  animation: spin 1s linear infinite;", "+  animation: spin 1s steps(20) infinite;"] },
            steer: "Run tests/e2e/thread-scroll.spec.ts before we call this done.",
          },
        ],
      },
    );
    filesChat = ctx.thread(relay, "Where are the bridge's frames decoded?", 8, [asked, answer]);
  }
  // A note kept from far up a long thread, to jump back to.
  const long = [...threads.entries()].find(([, t]) => t.summary.title === "A very long history");
  if (ctx.seeded && long) {
    const [chatId, t] = long;
    const from = t.messages.at(-81);
    notesFor.set(chatId, [
      { id: "l1", text: `Answer ${from?.body}`, from: from?.id, ref: true, created: now - 30 * min, updated: now - 30 * min },
      { id: "l2", text: "The **forty-first** reply is where it settled.", from: from?.id, by: "claude", created: now - 20 * min, updated: now - 20 * min },
    ]);
  }
  if (ctx.seeded && swift) {
    const t = threads.get(swift)!;
    notesFor.set(swift, [
      { id: "n1", text: "Left to port:\n\n1. Route racing\n2. Delta patches\n3. Tunnel frames\n4. Drafts", done: [1], created: now - 50 * min, updated: now - 20 * min },
      { id: "n2", text: "Keep `RemoteClient` an **actor**: socket callbacks land on its queue in order, which the frames' counters need.", by: "claude", created: now - 40 * min, updated: now - 40 * min },
      { id: "n3", text: "Done with crypto and wire", from: t.messages.at(-1)?.id, ref: true, created: now - 10 * min, updated: now - 10 * min },
    ]);
  }
  const mark = (notes: any[]) => (notes.length ? `${notes.length}.${Math.max(...notes.map((n) => n.updated))}` : undefined);
  const setNotes = (chatId: string, notes: any[], quiet = false) => {
    notesFor.set(chatId, notes);
    const t = threads.get(chatId);
    if (!t) return notes;
    if (notes.length) t.summary.notesMark = mark(notes);
    else delete t.summary.notesMark;
    if (!quiet) ctx.changed(t.summary.projectId);
    return notes;
  };
  // Before the remote exists, so nothing to tell yet.
  for (const [chatId, notes] of notesFor) setNotes(chatId, notes, true);

  // The computer's updater: behind the phone, so Settings and Home offer an update, which
  // downloads, waits, then comes back on the new version.
  let version = ctx.seeded ? "0.0.9" : undefined;
  let update: any = { status: "idle", current: version };
  const updateNow = () => {
    if (update.status !== "idle") return update;
    const next = "0.1.0";
    update = { status: "downloading", current: version, version: next, progress: 0 };
    const tick = setInterval(() => {
      if (update.status === "downloading" && update.progress < 1) {
        update = { ...update, progress: Math.min(1, update.progress + 0.25) };
      } else if (update.status === "downloading") {
        update = { status: "waiting", current: version, version: next, tasks: 1 };
      } else {
        clearInterval(tick);
        version = next;
        update = { status: "idle", current: version };
        console.error("updated to", version);
      }
    }, 1500);
    return update;
  };

  return {
    filesChat,
    version: version === undefined ? undefined : () => version!,
    tasks: (projectId: string) => tasks[projectId] ?? [],
    handoffs: {
      handle: async (method: string) => {
        if (method === "computerInfo") return { version, bridge: ctx.bridge, update };
        if (method === "updateNow") return updateNow();
        throw new Error("The stand-in doesn't take handoffs.");
      },
    },
    /** What live-desktop.ts's dispatch doesn't answer itself; undefined for the rest. */
    dispatch: (method: string, args: any[]) => {
      if (method === "projectFiles") return treeOf(args[0]).files;
      if (method === "projectFile") {
        const tree = treeOf(args[0]);
        const path = String(args[1]);
        if (!tree.files.includes(path)) throw new Error(`${path} isn't in this folder.`);
        const file = join(tree.base, path);
        if (statSync(file).size > 2 << 20) throw new Error("That file is too big to open on a phone.");
        return { path, branch: branchOf(args[0]), head: "9f8e7d6", contents: readFileSync(file, "utf8") };
      }
      if (method === "restartProjectTask") {
        const task = tasks[args[0]]?.find((t) => t.id === args[1]);
        if (task) task.started = Date.now();
        return;
      }
      if (method === "stopProjectTask") {
        tasks[args[0]] = (tasks[args[0]] ?? []).filter((t) => t.id !== args[1]);
        return;
      }
      if (method === "threadNotes") return notesFor.get(args[0]) ?? [];
      if (method === "tickThreadNote") {
        const notes = (notesFor.get(args[0]) ?? []).map((n) => {
          if (n.id !== args[1]) return n;
          const done = new Set<number>(n.done ?? []);
          if (args[3]) done.add(args[2] - 1);
          else done.delete(args[2] - 1);
          return { ...n, done: done.size ? [...done].sort((a, b) => a - b) : undefined, updated: Date.now() };
        });
        return setNotes(args[0], notes);
      }
      if (method === "removeThreadNote") return setNotes(args[0], (notesFor.get(args[0]) ?? []).filter((n) => n.id !== args[1]));
      if (method === "closeWatchNote") {
        const m = threads.get(args[0])?.messages.find((x) => x.id === args[1]);
        const note = m?.notes?.find((n: any) => n.id === args[2]);
        if (note) {
          Object.assign(note, { closed: true, how: args[3] });
          m.version += 1;
        }
        return;
      }
      return undefined;
    },
  };
}
