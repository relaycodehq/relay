// A stand-in desktop for the iOS app: the real PhoneRemote under plain Node,
// a fake host, a temp store, and 127.0.0.1 only. No Electron, nothing on
// screen. Writes the pairing link to the file named as the first argument and
// runs until killed. The Simulator shares this computer's network, so it can
// pair with it.
//
//   node_modules/.bin/jiti ios/scripts/live-desktop.ts /tmp/relay-ios-pair.txt [--seed] [--lan]
//
// Bare: one empty thread whose title changes every second (the live bridge test).
// --seed: sample threads in every state, a message sent from the phone gets a
// streamed answer back, and dictation hears the same sentence whatever is said.
// Either way the first project runs a stand-in dev server on a free 127.0.0.1
// port, which Sites lists as "Dev server" and the phone's tunnel opens.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const { Store } = await import(join(root, "electron/app/store.ts"));
const { PhoneRemote } = await import(join(root, "electron/remote/phone-remote.ts"));

const out = process.argv[2];
if (!out) throw new Error("Usage: live-desktop.ts <file for the pairing link> [--seed]");
const seeded = process.argv.includes("--seed");
// Replies slow enough to queue behind or steer by hand.
const slow = process.argv.includes("--slow");
const store = new Store(join(await mkdtemp(join(tmpdir(), "relay-ios-live-")), "state"));
await store.load();
// --lan: listen on this computer's Wi-Fi address too, for a real phone, with no tailnet.
const lan = process.argv.includes("--lan");
await store.update((s: any) => {
  s.phoneRemote = { lan };
});
const port = await new Promise<number>((done) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const p = (probe.address() as any).port;
    probe.close(() => done(p));
  });
});

const now = Date.now();
const min = 60_000;
const relay = "11111111-1111-4111-8111-111111111111";
const site = "33333333-3333-4333-8333-333333333333";
const scratchA = "66666666-6666-4666-8666-000000000001";
const scratchB = "66666666-6666-4666-8666-000000000002";
const dotfiles = "77777777-7777-4777-8777-777777777777";
// The relay project's own icon, as the desktop finds one in a project's folder.
const relayIcon = `data:image/png;base64,${(await readFile(join(root, "ios/Relay/Resources/Assets.xcassets/AppIcon.appiconset/icon.png"))).toString("base64")}`;
const projects = seeded
  ? [
      { id: relay, name: "relay", path: "/tmp/relay", repository: null, added: 1 },
      { id: site, name: "relaycode.io", path: "/tmp/site", repository: null, added: 2 },
      { id: dotfiles, name: "dotfiles", path: "/tmp/dotfiles", repository: null, added: 3, folder: "Side projects", plain: true },
      { id: scratchA, name: "Scratchpad", path: "/tmp/scratch-1", repository: null, added: 4, scratch: true },
      { id: scratchB, name: "Scratchpad", path: "/tmp/scratch-2", repository: null, added: 5, scratch: true },
    ]
  : [{ id: relay, name: "Relay", path: "/tmp/relay", repository: null, added: 1 }];

type Thread = { summary: any; messages: any[]; requests?: any[]; lastInput?: any; lastParentId?: string | null; queue?: any[]; scheduled?: any[]; queuePaused?: boolean };
const threads = new Map<string, Thread>();
let n = 0;
const id = () => `44444444-4444-4444-8444-${String(++n).padStart(12, "0")}`;
const lastInput = {
  id: "55555555-5555-4555-8555-555555555555",
  body: "Last thing sent",
  provider: "claude",
  choice: { model: "claude-opus-5-5", fast: false, reasoningEffort: "high" },
  runtimeMode: "full-access",
  interactionMode: "default",
};
const message = (role: "user" | "assistant", body: string, ago: number, extra: object = {}) => ({
  id: id(),
  role,
  body,
  status: "complete",
  created: now - ago * min,
  provider: "claude",
  version: 1,
  ...extra,
});
const step = (label: string, kind = "command", extra: object = {}) => ({ id: id(), kind, label, status: "complete", ...extra });
const spinnerAnswer = `## What was eating it

The spinner animated **every display refresh**, so a visible window behind the editor repainted at 120Hz.

\`\`\`css
.spinner {
  animation: spin 1s steps(20) infinite;
}
\`\`\`

- Stepped the loop at 20 updates a second
- Paused it while the window is unfocused
- [x] Checked the sidebar spinners
- [ ] Profile the shimmer next

| Spinner | Before | After |
|---|---|---|
| Menubar | 18% | ~2% |
| \`.live-shine\` | 17% | 2% |

> Reduced motion still stops it entirely.`;
const sampleOutput = Array.from({ length: 80 }, (_, i) => `${String(i * 12).padStart(5)} Relay  CoreAnimation::Transaction::commit  ${(18 - i * 0.2).toFixed(1)}%`).join("\n");
const spinnerTrace = () => {
  const calls = [
    step("sample Relay 5 -file /tmp/relay.sample", "command", { detail: sampleOutput }),
    step("/tmp/relay/src/styles.css", "read"),
    step("rg -n 'infinite' src", "search"),
    step("/tmp/relay/src/styles.css", "file"),
    step("npm run test:unit -- spinner", "command", { status: "failed", detail: "1 test failed: spinner pauses when unfocused" }),
    step("npm run test:unit -- spinner", "command", { detail: "✓ 4 tests passed" }),
  ];
  return [
    { kind: "commentary", id: id(), text: "Sampling Relay while one thread runs." },
    { kind: "activity", id: calls[0].id, activity: calls[0] },
    { kind: "activity", id: calls[1].id, activity: calls[1] },
    { kind: "activity", id: calls[2].id, activity: calls[2] },
    { kind: "commentary", id: id(), text: "It's the **spinner**: stepping it." },
    ...calls.slice(3).map((a) => ({ kind: "activity", id: a.id, activity: a })),
  ];
};
/** The seeded pages' HTML, by render and variant. */
const bars = (colours: string[]) => `<!doctype html><html><head><style>
body{padding:14px;font:14px var(--font-sans)}h3{margin:0 0 10px}.row{display:flex;align-items:end;gap:8px;height:140px}
.bar{flex:1;border-radius:6px 6px 0 0}button{margin-top:12px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--accent);color:var(--accent-foreground);font:inherit}
a{color:var(--accent)}</style></head><body>
<h3>Tokens per day</h3><div class="row">${colours.map((c, i) => `<div class="bar" style="background:${c};height:${30 + ((i * 37) % 70)}%"></div>`).join("")}</div>
<p style="color:var(--muted)">Sample data. <a href="https://relaycode.io">relaycode.io</a></p>
<button onclick="relay.compose('Go with ' + document.title)">Use this one</button></body></html>`;
const pages: Record<string, string[]> = {
  "77777777-7777-4777-8777-0000000000a1": [
    bars(["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"]).replace("<head>", "<head><title>Calm</title>"),
    bars(["var(--accent)", "#ff5a5a", "var(--accent)", "#ffb020", "var(--accent)", "#ff5a5a"]).replace("<head>", "<head><title>Loud</title>"),
  ],
  "77777777-7777-4777-8777-0000000000a2": [`<!doctype html><html><head><style>
body{padding:14px;font:14px var(--font-sans)}label{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px}
</style></head><body><p>Which sound should a finished thread play?</p>
${["Glass", "Pop", "Tink", "None"].map((s) => `<label><input type="radio" name="s" value="${s}" onchange="relay.answer({sound:this.value})">${s}</label>`).join("")}
</body></html>`],
};

function thread(projectId: string, title: string, ago: number, messages: any[], extra: object = {}, requests?: any[]) {
  const chatId = seeded ? id() : "22222222-2222-4222-8222-222222222222";
  threads.set(chatId, {
    summary: { id: chatId, projectId, title, scope: { kind: "project" }, created: 1, updated: now - ago * min, provider: "claude", ...extra },
    messages,
    requests,
  });
  return chatId;
}

if (!seeded) {
  thread(relay, "Fix the flaky test", 0, []);
} else {
  thread(relay, "Which port should the preview use?", 2, [
    message("user", "Wire the preview server into the worktree setup.", 9),
    message("assistant", "The setup runs `npm run dev`, but **5177** is taken by your main checkout. I'll keep going on the rest meanwhile.", 2, {
      activity: [step("npm run dev"), step("lsof -i :5177"), step("worktree-setup.ts", "read")],
      questions: [{
        id: "toolu_01port",
        questions: [{
          id: "0",
          header: "Port",
          question: "Which port should worktree previews use?",
          options: [
            { label: "Offset per worktree", description: "5178, 5179, … so each worktree runs its own" },
            { label: "Reuse 5177", description: "Share the main checkout's server" },
          ],
        }],
      }],
    }),
  ], { waiting: true, asking: true });
  thread(relay, "Add vitest to the website", 3, [
    message("user", "Set up vitest for the website package.", 4),
    message("assistant", "", 3, { status: "streaming", activity: [step("package.json", "read")] }),
  ], { running: true, runningSince: now - 4 * min, waiting: true, blocked: true }, [
    {
      id: "66666666-6666-4666-8666-000000000001",
      kind: "approval",
      title: "Run npm install --save-dev vitest",
      detail: "npm install --save-dev vitest @vitest/coverage-v8",
      decisions: ["decline", "acceptForSession", "accept", "cancel"],
    },
    {
      id: "66666666-6666-4666-8666-000000000002",
      kind: "question",
      title: "Claude has questions",
      questions: [
        { id: "0", header: "Environment", question: "Which test environment?", options: [{ label: "node" }, { label: "jsdom", description: "For the components that touch the DOM" }] },
        { id: "1", header: "Extras", question: "Anything else to set up?", multiple: true, options: [{ label: "Coverage" }, { label: "UI mode" }, { label: "CI job" }] },
      ],
    },
  ]);
  thread(relay, "Port the bridge to Swift", 1, [
    message("user", "Port shared/remote-client to Swift for the iPhone app.", 30),
    message("assistant", "Done with crypto and wire: CryptoKit matches noble byte for byte. Now on the route racing.", 1, {
      status: "streaming",
      activity: [step("swift test"), step("RemoteClient.swift", "file"), step("Dial.swift", "file")],
    }),
  ], { running: true, runningSince: now - 6 * min, branch: "ios-app", worktree: true });
  {
    const swift = [...threads.values()].at(-1)!;
    const later = (body: string) => ({ ...queuedSend(body), id: id() });
    swift.queue = [later("@claude then wire it into the composer"), later("@claude and run the live test against a real desktop")];
    swift.scheduled = [{ ...later("@claude check the TestFlight build went through"), at: now + 20 * min }];
    swift.summary.queueMark = "seed";
  }
  const trimmed = message("assistant", "Cut it by about a third. The table now leads with what each tool *can't* do, which is the honest bit people look for.", 45, {
    context: { usedTokens: 142_000, maxTokens: 200_000, totalTokens: 1_240_000 },
    cost: 0.86,
    model: { name: "Opus 5.5" },
    activity: [step("compare/index.html", "file"), step("npm run build:website")],
  });
  const aside = message("user", "Does the table still fit on a phone?", 44, { parentId: trimmed.id });
  const btw = message("user", "what font does the table use?", 43, { side: true });
  thread(site, "Compare page copy pass", 45, [
    message("user", "Tighten the compare page copy, it reads like a brochure.", 70),
    trimmed,
    aside,
    message("assistant", "It does: the columns stack under 600px.", 44, { parentId: aside.id }),
    btw,
    message("assistant", "Inter, the same as the rest of the site.", 43, { parentId: btw.id }),
  ]);
  // Long enough that a lazy list has to guess most row heights.
  thread(relay, "A long thread to scroll", 240, Array.from({ length: 30 }, (_, i) => [
    message("user", `Question ${i + 1}: what does step ${i + 1} change?`, 300 - i * 2),
    message("assistant", `## Step ${i + 1}\n\n${"It moves the work along a little and keeps the rest as it was. ".repeat(3 + (i % 5))}\n\n\`\`\`ts\nconst step = ${i + 1};\nrun(step);\n\`\`\`\n\n- one\n- two\n- three${i === 29 ? "\n\nThe very last line of the thread." : ""}`, 299 - i * 2, {
      ended: now - (298 - i * 2) * min,
      trace: [{ kind: "activity", ...(() => { const a = step(`npm test -- step${i + 1}`); return { id: a.id, activity: a }; })() }],
    }),
  ]).flat(), { settledAt: now - 230 * min });
  // Math: display formulas KaTeX typesets, inline ones as plain text or their TeX.
  thread(relay, "Why does softmax subtract the max?", 15, [
    message("user", "Why does the softmax code subtract the max first?", 16),
    message("assistant", String.raw`Softmax turns scores $x_i$ into probabilities:

$$
\sigma(x)_i = \frac{e^{x_i}}{\sum_{j=1}^{n} e^{x_j}}
$$

For $x_i = 1000$, $e^{x_i}$ overflows to infinity. Subtracting $m = \max_j x_j$ changes nothing, since the factor cancels:

$$
\frac{e^{x_i - m}}{\sum_j e^{x_j - m}} = \frac{e^{-m} e^{x_i}}{e^{-m} \sum_j e^{x_j}}
$$

So every exponent is $\le 0$ and the biggest term is exactly $1$. A ragged one stays as source: $\mathbb{R}^{n \times n}$.`, 15),
  ]);
  // show_html and ask_html: a chart in two variants that composes, and a page that answers.
  thread(relay, "Pick a palette for the usage chart", 20, [
    message("user", "Show me a couple of palettes for the usage chart.", 25),
    message("assistant", "Two takes on it. **Calm** keeps to the theme's series colours; **Loud** leans on the accent.", 20, {
      renders: [{ id: "77777777-7777-4777-8777-0000000000a1", title: "Usage chart palettes", created: now - 20 * min, pages: [{ label: "Calm" }, { label: "Loud" }] }],
      questions: [{ id: "toolu_sound", page: { id: "77777777-7777-4777-8777-0000000000a2", title: "Pick a finish sound", created: now - 20 * min, pages: [{}] }, questions: [] }],
    }),
  ], { waiting: true, asking: true });
  thread(relay, "Why is the menubar spinner eating CPU?", 180, [
    message("user", "Activity Monitor says Relay sits at 18% with one thread running.", 200),
    message("assistant", "", 195, {
      compaction: true,
      compactedFrom: 281_000,
      context: { usedTokens: 8_900 },
      compactSummary: "The user is chasing **Relay's idle CPU**: one running thread costs 18% of a core.",
    }),
    message("assistant", spinnerAnswer, 180, {
      ended: now - 178 * min,
      trace: spinnerTrace(),
      streamed: { output: 3_800, ms: 50_000 },
      cost: 0.42,
      changes: [
        { path: "src/styles.css", additions: 14, deletions: 3 },
        { path: "src/lib/window-focus.ts", additions: 22, deletions: 0 },
        { path: "src/features/sidebar/Spinner.tsx", additions: 5, deletions: 9 },
        { path: "AGENTS.md", additions: 6, deletions: 1 },
      ],
    }),
  ], { settledAt: now - 170 * min, provider: "claude" });
  // Home's other states: snoozed, woken, marked unread, a lead with the threads it started.
  thread(site, "Draft the launch tweet", 30, [message("user", "Write three takes on the launch tweet.", 31)], { snoozedAt: now - 30 * min, snoozedUntil: now + 90 * min, provider: "codex" });
  thread(relay, "Check the Windows installer", 300, [message("user", "Does the installer still sign?", 301)], { snoozedAt: now - 400 * min, snoozedUntil: now - 20 * min, seenAt: now - 300 * min });
  thread(scratchA, "Explain CRDTs like I'm five", 600, [
    message("user", "Explain CRDTs like I'm five.", 601),
    message("assistant", "Two kids draw on copies of one picture, and whatever each adds can be put together the same way every time.", 600),
  ], { settledAt: now - 590 * min });
  thread(scratchB, "Czech word for spinner", 15, [
    message("user", "What's the Czech word for a loading spinner?", 16),
    message("assistant", "Usually just *načítání* (loading), or *kolečko* for the little wheel.", 15),
  ]);
  thread(site, "Tidy the footer links", 50, [message("assistant", "Done: the footer links all point at the new pages.", 50)], { markedUnread: true, branch: "site/footer" });
  const lead = thread(relay, "Split the settings page", 12, [message("assistant", "Started two threads: one per half of the page.", 12)]);
  thread(relay, "Settings: account half", 6, [message("assistant", "", 6, { status: "streaming" })], { startedBy: { chatId: lead, agent: "claude" }, running: true, runningSince: now - 6 * min, created: 2 });
  thread(relay, "Settings: appearance half", 8, [message("assistant", "Moved the theme rows.", 8)], { startedBy: { chatId: lead, agent: "claude" }, created: 3 });
}

const summaries = () => [...threads.values()].map((t) => t.summary);

// What the composer's model picker asks for.
const efforts = ["low", "medium", "high", "xhigh", "max"];
const catalogs: Record<string, any[]> = {
  claude: [
    { id: "claude-opus-5-5", name: "Opus 5.5", description: "Most capable for hard work", efforts, defaultEffort: "high", longContext: true },
    { id: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "Fast and capable", efforts, longContext: true },
    { id: "claude-haiku-5-5", name: "Haiku 5.5", description: "Quickest for simple work" },
    { id: "claude-opus-5", name: "Opus 5", description: "The previous Opus", efforts, legacy: true },
  ],
  codex: [
    { id: "gpt-6-sol", name: "GPT-6-Sol", description: "Frontier coding model", efforts: [...efforts, "ultra"] },
    { id: "gpt-6-luna", name: "GPT-6-Luna", description: "Smaller and quicker", efforts },
    { id: "gpt-5.5", name: "GPT-5.5", description: "Older", efforts: efforts.slice(0, 4), legacy: true },
  ],
  cursor: [
    { id: "auto", name: "Auto", description: "Cursor picks", fast: true },
    { id: "composer-2", name: "Composer 2", description: "Cursor's own" },
  ],
};
const agentDefaults: Record<string, any> = {
  claude: { model: "claude-opus-5-5", effort: "high" },
  codex: { model: "gpt-6-sol", effort: "medium" },
};
let newThreadAgent: string | null = null;
const newThreadModels: Record<string, any> = {};

/** A thread made from the phone, empty until its first message. */
/** The desktop's New chat: a fresh Scratchpad folder each time here. */
function scratched() {
  const project = { id: id(), name: "Scratchpad", path: `/tmp/scratch-${n}`, repository: null, added: Date.now(), scratch: true };
  projects.push(project);
  return project;
}
function created(projectId: string, workspace?: string) {
  const chatId = thread(projectId, "New thread", 0, [], {
    empty: true,
    ...(workspace === "worktree" ? { worktree: true, branch: "relay/new-thread" } : {}),
  });
  changed(projectId);
  return threads.get(chatId)!.summary;
}
// What the phone's browser opens through the tunnel: two pages that show the
// Host they were asked for as, and /big, 5 MiB that deflate, for the tunnel's
// credit and packed frames.
const big = Buffer.alloc(5 * 1024 * 1024);
for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 11)) & 255;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const devPage = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:40px 24px}@media(prefers-color-scheme:dark){body{color:#e6e6e6;background:#141414}a{color:#aaa8e5}}</style>` +
  `<h1>${title}</h1>${body}`;
const devServer = await new Promise<number>((done) => {
  const server = createHttpServer((req, res) => {
    const path = (req.url ?? "/").split(/[?#]/)[0];
    if (path === "/big") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": big.length });
      return res.end(big);
    }
    const asked = `<p>Asked for as <code>${escape(req.headers.host ?? "")}</code>.</p>`;
    const html =
      path === "/"
        ? devPage("Stand-in dev server", `<p>Served from this computer's loopback through the phone's tunnel.</p>${asked}<p><a href="/about">Another page</a></p>`)
        : path === "/about"
          ? devPage("Another page", `<p>Links on a tunnelled page stay in the tunnel.</p>${asked}<p><a href="/">Back</a></p>`)
          : undefined;
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.listen(0, "127.0.0.1", () => done((server.address() as any).port));
});
const devTask = { id: "dev-server", command: "npm run dev", kind: "server", title: "Dev server", origin: "detached", started: now, ports: [devServer], pids: 1 };
// An answer that links to the dev server, which the phone opens through the tunnel.
if (seeded) thread(relay, "Is the preview up?", 12, [
  message("user", "Is the preview server running?", 13),
  message("assistant", `It is, at http://localhost:${devServer}/about. Have a look.`, 12),
]);

const host = {
  renderPage: async (_chatId: string, renderId: string, page: number) => {
    const html = pages[renderId]?.[page];
    if (html == null) throw new Error("That page isn't there any more.");
    return html;
  },
  projects: async () => projects,
  projectPath: (pid: string) => (pid === site ? "/tmp/site" : "/tmp/relay"),
  chats: (pid: string) => summaries().filter((c) => c.projectId === pid),
  chat: async (chatId: string) => {
    const t = threads.get(chatId)!;
    // A summary says only whether there's a worktree; the thread says which.
    const worktree = t.summary.worktree ? { branch: t.summary.branch } : undefined;
    const root = t.summary.projectId === site ? "/tmp/site" : "/tmp/relay";
    const last = t.lastInput ?? (seeded ? lastInput : undefined);
    const queued = {
      queue: (t.queue ?? []).map((input) => ({ input })),
      scheduled: (t.scheduled ?? []).map(({ at, ...input }) => ({ input, at })),
      ...(t.queuePaused ? { queuePaused: true } : {}),
    };
    return { ...t.summary, ...queued, lastParentId: t.lastParentId ?? null, worktree, root, messages: t.messages, ...(t.requests?.length ? { requests: t.requests } : {}), ...(last ? { lastInput: last } : {}) };
  },
  dispatch: async (method: string, args: any[]) => {
    console.error("dispatch", method, method === "sendProjectChat" ? JSON.stringify({ body: args[1].body, to: args[1].to, mode: args[1].interactionMode, runtime: args[1].runtimeMode, parentId: args[1].parentId, side: args[1].side, sendAt: args[1].sendAt, images: args[1].images?.map((i: any) => [i.name, i.dataUrl.length]) }) : JSON.stringify(args).slice(0, 300));
    if (method === "sendProjectChat") sent(args[0], args[1]);
    if (method === "cancelProjectChat") stopped.add(args[0]);
    if (method === "projectChatQueueAction") queueAction(args[0], args[1], args[2], args[3]);
    if (method === "projectChatQueuedImages") return [];
    if (method === "triageProjectChat") return triaged(args[0], args[1]);
    if (method === "markProjectChatSeen") seenUpTo(args[0], args[1]);
    if (method === "renameProjectChat") renamed(args[0], args[1]);
    if (method === "regenerateProjectChatTitle") renamed(args[0], "A fresh name from the stand-in");
    if (method === "compactProjectChat") compacted(args[0]);
    if (method === "respondProjectChat") responded(args[0], args[1], args[2]);
    if (method === "answerProjectChatQuestion") answered(args[0], args[1], args[2], args[3]);
    if (method === "setProjectChatQuestionDismissed") dismissed(args[0], args[1], args[2], args[3]);
    if (method === "projectCommands") return agentCommands[args[1]] ?? [];
    if (method === "providerUsage") return usageOf(args[0]);
    if (method === "agentModels") return catalogs[args[0]] ?? [];
    if (method === "agentDefaults") return agentDefaults[args[1]] ?? null;
    if (method === "aiSettings") return { threadProvider: "claude", questionsProvider: "claude" };
    if (method === "newThreadAgent") return newThreadAgent;
    if (method === "newThreadModels") return newThreadModels;
    if (method === "saveNewThreadAgent") newThreadAgent = args[0];
    if (method === "saveNewThreadModel") newThreadModels[args[0]] = args[1];
    if (method === "createProjectChat") return created(args[0], args[2]);
    if (method === "forkProjectChat") return forked(args[0], args[1]);
    if (method === "rewindProjectTurn") return rewound(args[0], args[1], args[2], args[3]);
    if (method === "projectTurnDiff") return turnDiff(args[2]);
    if (method === "projectIcon") return args[0] === relay ? relayIcon : null;
    if (method === "createScratch") return scratched();
    if (method === "projectTasks") return args[0] === relay ? [devTask] : [];
    return undefined;
  },
  name: () => "Stand-in Mac",
  // The desktop's default "relay" theme, as src/lib/appearance.ts sends it.
  appearance: () => ({
    mode: "system",
    light: { kind: "light", sidebar: "#ececee", surface: "#ffffff", toolbar: "#f9f9fa", inbox: "#f7f7f8", text: "#303237", muted: "#676972", border: "#e2e3e6", hover: "#e5e5e9", selected: "#dedee8", accent: "#6565a9", accentSoft: "#f0f0f6", onAccent: "#ffffff", send: "#aaa8e5", onSend: "#1b1b22", diffAddition: "#d6efdd", diffDeletion: "#f9dcdf" },
    dark: { kind: "dark", sidebar: "#232326", surface: "#1e1e21", toolbar: "#242427", inbox: "#28282c", text: "#e1e1e5", muted: "#94949f", border: "#37373d", hover: "#34343c", selected: "#41414f", accent: "#aaa8e5", accentSoft: "#373744", onAccent: "#1b1b22", send: "#aaa8e5", onSend: "#1b1b22", diffAddition: "#213f2d", diffDeletion: "#45272c" },
  }),
  readAloud: seeded ? fakeVoice() : undefined,
  dictation: seeded ? fakeSpeech() : undefined,
};
// Sealing stands in for the OS keychain; Tailscale is "connected" on loopback.
const remote = new PhoneRemote(
  store,
  async (v: string) => "sealed:" + v,
  async (v: string) => v.slice(7),
  host as any,
  port,
  async () => (lan ? { status: "stopped", addresses: [] } : { status: "connected", addresses: ["127.0.0.1"] }),
  lan ? undefined : () => [],
);

const stopped = new Set<string>();

/** A speech engine that "hears" a word for every half second of audio, whatever was said. */
function fakeSpeech() {
  const words = "Make the send button round and keep the mic working".split(" ");
  const heard = (samples: number) => words.slice(0, Math.min(words.length, Math.floor(samples / 8000)));
  return {
    status: () => "ready" as const,
    open: () => {
      let listener: ((m: { data: any }) => void) | undefined;
      let id = 0;
      let samples = 0;
      const emit = (data: any) => setTimeout(() => listener?.({ data }), 0);
      return {
        on: (_: "message", l: (m: { data: any }) => void) => (listener = l),
        start() {},
        close() {},
        postMessage(m: any) {
          if (m.type === "start") {
            [id, samples] = [m.id, 0];
            setTimeout(() => emit({ type: "ready" }), 400);
          } else if (m.type === "audio") {
            samples += m.samples.length;
            const got = heard(samples);
            emit({ type: "text", id, settled: got.slice(0, -1).join(" "), tentative: got.at(-1) ?? "" });
          } else if (m.type === "stop") {
            emit({ type: "final", id, text: heard(samples).join(" ") + "." });
          }
        },
      };
    },
  };
}
const changed = (projectId: string) => remote.chatsEvent({ projectId } as any);

/** A voice that hums a soft tone for a few seconds, a second at a time, after a moment loading. */
function fakeVoice() {
  return {
    ready: () => true,
    speak(_markdown: string, sink: (speech: any) => void) {
      let stopped = false;
      const rate = 24_000;
      sink({ type: "loading" });
      const chunks = [0, 1, 2, 3].map((k) =>
        Float32Array.from({ length: rate }, (_, i) => 0.15 * Math.sin((2 * Math.PI * (220 + 40 * k) * i) / rate)),
      );
      chunks.forEach((pcm, k) => setTimeout(() => !stopped && sink({ type: "audio", pcm, sampleRate: rate }), 600 + k * 300));
      setTimeout(() => !stopped && sink({ type: "end" }), 600 + chunks.length * 300);
      return { stop: () => (stopped = true) };
    },
  };
}

/** A new thread with the conversation up to the answer. */
function forked(chatId: string, messageId: string) {
  const t = threads.get(chatId)!;
  const upTo = t.messages.findIndex((m) => m.id === messageId);
  const copy = t.messages.slice(0, upTo + 1).map((m) => ({ ...m, id: id() }));
  const made = thread(t.summary.projectId, `${t.summary.title} (fork)`, 0, copy, { provider: t.summary.provider });
  changed(t.summary.projectId);
  return threads.get(made)!.summary;
}

/** Marks the turn's files rolled back, or clears the mark; nothing overlaps here. */
function rewound(chatId: string, messageId: string, paths: string[] | null, mode: string) {
  const t = threads.get(chatId)!;
  const m = t.messages.find((x) => x.id === messageId);
  for (const f of m.changes ?? []) {
    if (paths && !paths.includes(f.path)) continue;
    if (mode === "revert") f.revertedBy = "rollback";
    else delete f.revertedBy;
  }
  m.version += 1;
  remote.chatEvent({ chatId, message: { ...m, changes: m.changes.map((f: any) => ({ ...f })) } });
  return { conflicts: [] };
}

/** A file before and after the turn, made up around its name. */
function turnDiff(path: string) {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of ${path}`);
  const after = [...before];
  after.splice(4, 2, "// Stepped at 20 updates a second, paused while the window is unfocused.", "animation: spin 1s steps(20) infinite;");
  after.splice(20, 0, "  :root[data-inactive] & { animation-play-state: paused; }");
  const file = (lines: string[]) => ({ name: path, contents: lines.join("\n") + "\n", cacheKey: path + lines.length });
  return { old: file(before), next: file(after), binary: false };
}

/** A request answered: the next one waits, or the turn carries on and finishes. */
function responded(chatId: string, requestId: string, response: any) {
  const t = threads.get(chatId)!;
  const request = t.requests?.find((r) => r.id === requestId);
  if (!request) throw new Error("This request is no longer waiting for a response.");
  t.requests = t.requests!.filter((r) => r !== request);
  const reply = t.messages.at(-1);
  reply.activity.push(step(request.kind === "approval" ? `${request.title} (${response.decision})` : `Answered: ${JSON.stringify(response.answers ?? response.answer)}`, "tool"));
  reply.version += 1;
  if (!t.requests.length) {
    reply.body = response.decision === "decline" ? "Fine, I won't install it." : "Installed and configured. `npm test` runs the suite now.";
    reply.status = "complete";
    Object.assign(t.summary, { running: undefined, runningSince: undefined, waiting: undefined, blocked: undefined, updated: Date.now() });
  }
  remote.chatEvent({ chatId, message: { ...reply, activity: [...reply.activity] } });
  changed(t.summary.projectId);
}

/** An async question group answered: kept on its message, and the answer goes to the agent as a message. */
function answered(chatId: string, messageId: string, groupId: string, response: any) {
  const t = threads.get(chatId)!;
  const m = t.messages.find((x) => x.id === messageId);
  const group = m?.questions?.find((g: any) => g.id === groupId);
  if (!group || group.answers) throw new Error("This question is no longer available.");
  group.answers = response.kind === "page" ? { page: [response.answer ?? ""] } : response.answers;
  m.version += 1;
  remote.chatEvent({ chatId, message: m });
  Object.assign(t.summary, { asking: undefined, waiting: undefined });
  answer(chatId, { id: crypto.randomUUID(), body: "Answer to your questions:\n" + Object.values(group.answers).flat().join(", ") });
}

function dismissed(chatId: string, messageId: string, groupId: string, value: boolean) {
  const t = threads.get(chatId)!;
  const m = t.messages.find((x) => x.id === messageId);
  const group = m?.questions?.find((g: any) => g.id === groupId);
  if (!group) throw new Error("This question is no longer available.");
  group.dismissed = value || undefined;
  m.version += 1;
  remote.chatEvent({ chatId, message: m });
  Object.assign(t.summary, { asking: value ? undefined : true, waiting: value ? undefined : true });
  changed(t.summary.projectId);
}

function queuedSend(body: string) {
  return {
    body,
    to: "claude",
    provider: "claude",
    choice: { model: "claude-opus-5-5", reasoningEffort: "high" },
    runtimeMode: "full-access",
    interactionMode: "default",
  };
}
/** shared/projects/threads.ts's ChatTriage on a summary; answers it as the desktop would. */
function triaged(chatId: string, action: any) {
  const t = threads.get(chatId)!;
  const c = t.summary;
  const at = Date.now();
  if (action.kind === "settle") Object.assign(c, { settledAt: at });
  if (action.kind === "settle-when-done") Object.assign(c, { settledAt: at, settleWhenDone: at });
  if (action.kind === "archive") { threads.delete(chatId); changed(c.projectId); return { ...c, archivedAt: at }; }
  if (action.kind === "snooze") Object.assign(c, { snoozedAt: at, snoozedUntil: action.until });
  if (action.kind === "wake") Object.assign(c, { snoozedUntil: at });
  if (action.kind === "unsettle") { delete c.settledAt; c.unsettledAt = at; }
  if (action.kind === "unread") c.markedUnread = true;
  if (action.kind === "restore") {
    for (const key of Object.keys(action.from)) delete c[key];
    Object.assign(c, action.to);
  }
  changed(c.projectId);
  return { ...c };
}

function renamed(chatId: string, title: string) {
  const c = threads.get(chatId)!.summary;
  c.title = title;
  changed(c.projectId);
}

/** A compaction's marker, as a finished one reads. */
/** What each agent offers in a project: Claude's commands stand alone, Codex's are skills. */
const agentCommands: Record<string, unknown[]> = {
  claude: [
    { name: "review", description: "Review a pull request", source: "claude" },
    { name: "security-review", description: "Look for security issues in the pending changes", argumentHint: "[path]", source: "claude" },
  ],
  codex: [
    { name: "skill:release", displayName: "release", description: "Draft the release notes and tag", source: "repo" },
    { name: "skill:phone-parity", displayName: "phone-parity", description: "Bring a phone feature to the other platform", source: "repo" },
  ],
};

/** Plan limits: Claude's session burning a little fast, Codex near its limit. */
function usageOf(provider: string) {
  const h = 3_600_000;
  const at = Date.now();
  if (provider === "claude") return { provider, windows: [
    { kind: "session", usedPercent: 62, resetsAt: at + 2 * h, periodMs: 5 * h },
    { kind: "weekly", usedPercent: 34, resetsAt: at + 84 * h, periodMs: 168 * h },
  ] };
  if (provider === "codex") return { provider, windows: [
    { kind: "session", usedPercent: 91, resetsAt: at + h, periodMs: 5 * h },
    { kind: "weekly", usedPercent: 71, resetsAt: at + 30 * h, periodMs: 168 * h },
  ], credits: { balance: 62_500, unlimited: false } };
  return { provider, windows: [], message: "No usage limits reported" };
}

function compacted(chatId: string) {
  const t = threads.get(chatId)!;
  const m = { ...message("assistant", "", 0), created: Date.now(), compaction: true, compactedFrom: 120_000, context: { usedTokens: 6_000, maxTokens: 200_000 }, compactSummary: "Compacted from the phone." };
  t.messages.push(m);
  remote.chatEvent({ chatId, message: m });
}

function seenUpTo(chatId: string, at: number) {
  const c = threads.get(chatId)?.summary;
  if (!c) return;
  c.seenAt = Math.max(c.seenAt ?? 0, at);
  c.markedUnread = false;
  changed(c.projectId);
}

/** The queue changed: its mark tells phones to fetch the thread again. */
function queueMoved(t: Thread) {
  t.summary.queueMark = `${Date.now()}:${t.queue?.length ?? 0}:${t.scheduled?.length ?? 0}`;
  changed(t.summary.projectId);
}
/** While an answer runs a send waits in the queue, or with "steer" cuts in, as the desktop's does. */
function sent(chatId: string, send: any) {
  const t = threads.get(chatId);
  if (!t) return;
  if (send.sendAt) {
    (t.scheduled ??= []).push({ ...send, at: send.sendAt });
    t.summary.nextSend = Math.min(t.summary.nextSend ?? Infinity, send.sendAt);
    queueMoved(t);
    return;
  }
  if (t.summary.running && send.delivery === "queue") {
    (t.queue ??= []).push(send);
    queueMoved(t);
    return;
  }
  if (t.queuePaused) {
    t.queuePaused = undefined;
    queueMoved(t);
  }
  if (t.summary.running) {
    const end = cut.get(chatId);
    if (end) end();
    else cutSeeded(chatId, t);
  }
  answer(chatId, send);
}
/** A seeded answer that only looks like it runs, ended where it stands. */
function cutSeeded(chatId: string, t: Thread) {
  const reply = t.messages.findLast((m) => m.status === "streaming");
  if (!reply) return;
  Object.assign(reply, { status: "complete", version: reply.version + 1 });
  remote.chatEvent({ chatId, message: reply });
}
function queueAction(chatId: string, action: string, messageId: string, index?: number) {
  const t = threads.get(chatId)!;
  const list = t.queue?.some((q) => q.id === messageId) ? t.queue : t.scheduled ?? [];
  const at = list.findIndex((q) => q.id === messageId);
  if (at < 0) throw new Error("That message already went.");
  const [item] = list.splice(at, 1);
  if (action === "move") list.splice(index ?? 0, 0, item);
  queueMoved(t);
  if (action === "steer") sent(chatId, { ...item, at: undefined, delivery: "steer" });
}
/** Ends a running answer at once: a steer takes over from it. */
const cut = new Map<string, () => void>();

/** The user's message, then a reply streamed word by word, as an agent's would. */
function answer(chatId: string, send: any) {
  const t = threads.get(chatId);
  if (!t) return;
  stopped.delete(chatId);
  const asked = { ...message("user", send.body, 0), id: send.id, created: Date.now(), ...(send.parentId ? { parentId: send.parentId } : {}), ...(send.side ? { side: true } : {}) };
  // A reply or a `/btw` runs beside the thread, answered under what it asked.
  const beside = !!(send.parentId || send.side);
  t.lastParentId = send.parentId ?? null;
  if (send.to) {
    t.lastInput = { id: send.id, body: send.body, provider: send.to, choice: send.choice, runtimeMode: send.runtimeMode ?? "full-access", interactionMode: send.interactionMode ?? "default", ...(send.contextWindow ? { contextWindow: send.contextWindow } : {}) };
    t.summary.provider = send.to;
  }
  if (t.summary.empty) {
    t.summary.empty = undefined;
    t.summary.title = send.body.replace(/^@\w+\s*/, "").slice(0, 40) || "New thread";
  }
  t.messages.push(asked);
  remote.chatEvent({ chatId, message: asked });
  const reply = { ...message("assistant", "", 0), created: Date.now(), status: "streaming", activity: [] as any[], ...(beside ? { parentId: asked.id } : {}) };
  t.messages.push(reply);
  if (beside) Object.assign(t.summary, { updated: Date.now() });
  else Object.assign(t.summary, { running: true, runningSince: Date.now(), waiting: undefined, asking: undefined, updated: Date.now() });
  changed(t.summary.projectId);
  const on = send.choice ? `${send.to} on ${send.choice.model || "its default model"}, ${send.choice.reasoningEffort || "default"} effort${send.choice.fast ? ", fast" : ""}${send.contextWindow ? ", " + send.contextWindow : ""}` : send.to;
  const words = `Got it (${on}). You said: "${send.body}". This is the stand-in desktop, so here's a streamed reply to show the phone keeps up, one word at a time, with a step or two on the way.`.split(" ");
  let i = 0;
  cut.set(chatId, () => {
    clearInterval(tick);
    cut.delete(chatId);
    Object.assign(reply, { status: "complete", version: reply.version + 1 });
    remote.chatEvent({ chatId, message: { ...reply, activity: [...reply.activity] } });
  });
  // "busy" streams a long trace of commentary and calls first, like a real turn, which folds away once it ends.
  const busy = /\bbusy\b/i.test(send.body);
  const trace: any[] = [];
  if (busy) (reply as any).trace = trace;
  const tick = setInterval(() => {
    const done = i >= words.length || stopped.has(chatId);
    if (busy && i < 24 && trace.length < 36) {
      const call = step(`rg -n 'pass ${trace.length}' src`, "search");
      trace.push(
        { kind: "commentary", id: id(), text: `Looking at pass ${trace.length / 3 + 1}: ${"it checks one more corner of the code before going on. ".repeat(3)}` },
        { kind: "activity", id: call.id, activity: call },
        { kind: "activity", id: id(), activity: step(`src/pass-${trace.length}.ts`, "read") },
      );
      reply.version += 1;
      remote.chatEvent({ chatId, message: { ...reply, trace: [...trace], activity: [...reply.activity] } });
      return;
    }
    if (i === 3 && !busy) reply.activity.push(step("rg 'stand-in' ios/"));
    if (!done) reply.body += (i ? " " : "") + words[i++];
    reply.version += 1;
    if (done) {
      clearInterval(tick);
      cut.delete(chatId);
      reply.status = stopped.has(chatId) ? "cancelled" : "complete";
      if (beside) Object.assign(t.summary, { updated: Date.now() });
      else Object.assign(t.summary, { running: undefined, runningSince: undefined, updated: Date.now() });
      changed(t.summary.projectId);
      // Stopping holds the queue; otherwise the next one goes.
      if (stopped.has(chatId) && t.queue?.length) {
        t.queuePaused = true;
        queueMoved(t);
      } else if (!stopped.has(chatId) && t.queue?.length && !t.queuePaused) {
        const next = t.queue.shift();
        queueMoved(t);
        setTimeout(() => answer(chatId, next), 400);
      }
    }
    remote.chatEvent({ chatId, message: { ...reply, activity: [...reply.activity], ...(busy ? { trace: [...trace] } : {}) } });
  }, slow ? 400 : 120);
}

await remote.setEnabled(true);
const { url } = await remote.pairing();
await writeFile(out, url);
console.error("pid", process.pid, "url", url);
console.error("dev server", `http://127.0.0.1:${devServer}/`);
if (!seeded) {
  const only = [...threads.values()][0].summary;
  setInterval(() => {
    only.updated += 1;
    only.title = "Fix the flaky test " + only.updated;
    changed(relay);
  }, 1000);
}
