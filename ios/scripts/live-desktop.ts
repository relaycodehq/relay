// A stand-in desktop for the iOS app: the real PhoneRemote under plain Node,
// a fake host, a temp store, and 127.0.0.1 only. No Electron, nothing on
// screen. Writes the pairing link to the file named as the first argument and
// runs until killed. The Simulator shares this computer's network, so it can
// pair with it.
//
//   node_modules/.bin/jiti ios/scripts/live-desktop.ts /tmp/relay-ios-pair.txt [--seed] [--lan]
// Add --scroll-stress for a 600-message thread and a 360-entry "busy" trace.
//
// Bare: one empty thread whose title changes every second (the live bridge test).
// --seed: sample threads in every state, a message sent from the phone gets a
// streamed answer back, and dictation hears the same sentence whatever is said.
// Either way the first project runs a stand-in dev server on a free 127.0.0.1
// port, which Sites lists as "Dev server" and the phone's tunnel opens.
import { readFileSync, watchFile } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { filesFixture } from "./live-desktop-files.ts";

const root = resolve(import.meta.dirname, "../..");
const { DraftStore: DesktopDrafts } = await import("../../electron/drafts/store");
type DraftChange = import("../../shared/drafts").DraftChange;
type DraftWrite = import("../../shared/drafts").DraftWrite;
type DraftDevice = import("../../shared/drafts").DraftDevice;
const { Store } = await import(join(root, "electron/app/store.ts"));
const { PhoneRemote } = await import(join(root, "electron/remote/phone-remote.ts"));
const { remoteBridgeVersion } = await import(join(root, "shared/remote.ts"));

const out = process.argv[2];
if (!out) throw new Error("Usage: live-desktop.ts <file for the pairing link> [--seed]");
const seeded = process.argv.includes("--seed");
// Replies slow enough to queue behind or steer by hand.
const slow = process.argv.includes("--slow");
// Larger history and live trace for exercising lazy-list height corrections around a steer.
const scrollStress = process.argv.includes("--scroll-stress");
// A thread made from the phone takes a while to load and to take its first message.
const slowNew = process.argv.includes("--slow-new");
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
// --state <dir>: keep the pairing and port there, so a restarted stand-in is the same computer.
const stateAt = process.argv.indexOf("--state");
const stateDir = stateAt > 0 ? process.argv[stateAt + 1] : await mkdtemp(join(tmpdir(), "relay-ios-live-"));
await mkdir(stateDir, { recursive: true });
const store = new Store(join(stateDir, "state"));
await store.load();
// --lan: listen on this computer's Wi-Fi address too, for a real phone, with no tailnet.
const lan = process.argv.includes("--lan");
await store.update((s: any) => {
  s.phoneRemote = { ...s.phoneRemote, lan };
});
const keptPort = Number(await readFile(join(stateDir, "port"), "utf8").catch(() => "")) || undefined;
const port = keptPort ?? await new Promise<number>((done) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const p = (probe.address() as any).port;
    probe.close(() => done(p));
  });
});
await writeFile(join(stateDir, "port"), String(port));

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
/** Each thread's subagents, as projectChatAgents lists them. */
const subagents = new Map<string, any[]>();
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
    // The last one is a reply, waiting for its side conversation under the first answer.
    const answer = swift.messages.find((m: any) => m.role === "assistant");
    swift.queue = [later("@claude then wire it into the composer"), later("@claude and run the live test against a real desktop"),
      ...(answer ? [{ ...later("@claude does that hold for the tunnel too?"), parentId: answer.id }] : [])];
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
  const scrollSteps = scrollStress ? 300 : 30;
  thread(relay, "A long thread to scroll", 240, Array.from({ length: scrollSteps }, (_, i) => [
    message("user", `Question ${i + 1}: what does step ${i + 1} change?`, 240 + (scrollSteps - i) * 2),
    message("assistant", `## Step ${i + 1}\n\n${"It moves the work along a little and keeps the rest as it was. ".repeat(3 + (i % 5))}\n\n\`\`\`ts\nconst step = ${i + 1};\nrun(step);\n\`\`\`\n\n- one\n- two\n- three${i === scrollSteps - 1 ? "\n\nThe very last line of the thread." : ""}`, 239 + (scrollSteps - i) * 2, {
      ended: now - (238 + (scrollSteps - i) * 2) * min,
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
  // Asked by the lead's agent: its name opens the lead.
  thread(relay, "Settings: appearance half", 8, [
    message("user", "Move the theme rows into their own section.", 9, { author: "Claude", fromThread: lead }),
    message("assistant", "Moved the theme rows.", 8),
  ], { startedBy: { chatId: lead, agent: "claude" }, created: 3 });
  {
    // The lead's turn names the threads its start_threads call made, as the thread lists them.
    const started = [...threads.entries()].filter(([, t]) => t.summary.startedBy?.chatId === lead).map(([chatId, t]) => ({ id: chatId, title: t.summary.title }));
    const call = step("Started threads", "tool", { mcp: { server: "relay", tool: "start_threads" }, detail: JSON.stringify(started) });
    Object.assign(threads.get(lead)!.messages[0], { trace: [{ kind: "activity", id: call.id, activity: call }], created: now - 13 * min, ended: now - 12 * min });
  }
  seedThreadStates();
}

/** The thread screen's states: subagents out, a stopped turn, a waiting plan, a goal, a long history and the strips. */
function seedThreadStates() {
  // A fan-out: two agents still out, one back.
  const audit = thread(relay, "Audit the bridge for races", 1, [
    message("user", "Audit the remote bridge for races. Fan out if it helps.", 6),
    message("assistant", "Splitting it three ways: the client, the tunnel and the drafts.", 5, {
      status: "streaming",
      trace: [{ kind: "activity", id: "toolu_agent_a", activity: { id: "toolu_agent_a", kind: "agent", label: "Read the remote client", status: "running", progress: "12 calls" } },
        { kind: "activity", id: "toolu_agent_b", activity: { id: "toolu_agent_b", kind: "agent", label: "Check the tunnel's credit", status: "running" } },
        { kind: "activity", id: "toolu_agent_c", activity: { id: "toolu_agent_c", kind: "agent", label: "Look at draft merges", status: "complete" } }],
    }),
  ], { running: true, runningSince: now - 5 * min, pending: [
    { kind: "task", id: "task-a", description: "Read the remote client", since: now - 5 * min, agent: true },
    { kind: "task", id: "task-b", description: "Check the tunnel's credit", since: now - 4 * min, agent: true },
  ] });
  const read = (path: string) => step(path, "read");
  subagents.set(audit, [
    { id: "toolu_agent_a", taskId: "task-a", description: "Read the remote client", type: "Explore", model: "claude-sonnet-5-5", status: "running", started: now - 5 * min, calls: 12,
      summary: "Following the reconnect path through Dial.swift", recent: [read("/tmp/relay/ios/RelayKit/Sources/RelayRemote/Client/Dial.swift")], provider: "claude",
      brief: "Read ios/RelayKit/Sources/RelayRemote/Client end to end. Look for any state touched off the client's queue, any continuation resumed twice, and any timer that outlives a closed socket. ".repeat(3).trim(),
      trace: [{ kind: "commentary", id: "c1", text: "Starting with how a call waits for its answer." },
        ...[read("/tmp/relay/ios/RelayKit/Sources/RelayRemote/Client/RemoteClient.swift"), step("rg -n 'resume(' ios/RelayKit", "search"), read("/tmp/relay/ios/RelayKit/Sources/RelayRemote/Client/Dial.swift")].map((a) => ({ kind: "activity", id: a.id, activity: a })),
        { kind: "commentary", id: "c2", text: "Each continuation is removed from `pending` before it resumes, so a late answer finds nothing." }] },
    { id: "toolu_agent_b", taskId: "task-b", description: "Check the tunnel's credit", type: "general-purpose", status: "running", started: now - 4 * min, calls: 3,
      recent: [{ ...step("swift test --filter TunnelStreams"), status: "running" }], provider: "claude", trace: [] },
    { id: "toolu_agent_c", description: "Look at draft merges", type: "Explore", model: "claude-haiku-5-5", status: "completed", started: now - 5 * min, ended: now - 2 * min, calls: 7,
      outcome: "No race: every write goes through the store's serial queue. The merge keeps the newest rev.", recent: [], provider: "claude",
      brief: "Check whether two devices writing one draft can lose text.",
      trace: [read("/tmp/relay/electron/drafts/store.ts"), read("/tmp/relay/shared/drafts.ts")].map((a) => ({ kind: "activity", id: a.id, activity: a })),
      report: "No race: every write goes through the store's serial queue. The merge keeps the newest rev, and a stale base comes back as a conflict the phone shows." },
  ]);
  // Stopped by hand: Resume answer picks it back up.
  thread(relay, "Rename the settings keys", 25, [
    message("user", "Rename the old settings keys to the new scheme and migrate stored values.", 30),
    message("assistant", "Renamed `theme` and `font` so far; the migration is half written.", 26, {
      status: "cancelled", ended: now - 25 * min, activity: [step("src/settings/keys.ts", "file"), step("npm run typecheck")],
    }),
  ]);
  // A plan waiting for its go-ahead.
  thread(relay, "Plan the offline mode", 35, [
    message("user", "Plan offline mode for the phone. Don't change anything yet.", 40),
    message("assistant", "## Plan\n\n1. Save each opened thread to disk, per computer\n2. Copy the latest eight ahead of time\n3. Show the saved copy while the link is down\n\nNothing changed yet.", 35, { proposedPlan: true }),
  ]);
  // Codex's /goal at work.
  thread(relay, "Get the e2e suite green", 2, [
    message("user", "/goal All e2e specs pass on CI", 50),
    message("assistant", "Fixed the quit spec; on the thread-scroll one now.", 2, { status: "streaming", provider: "codex", activity: [step("npx playwright test thread-scroll")] }),
  ], { running: true, runningSince: now - 50 * min, provider: "codex",
    goal: { provider: "codex", objective: "All e2e specs pass on CI", status: "active", tokensUsed: 182_000, tokenBudget: 1_000_000, timeUsedSeconds: 2_460, checks: 3, updated: now - 2 * min } });
  // A usage limit stopped the answer; it carries on at the reset.
  {
    const reset = new Date(now + 40 * min).toTimeString().slice(0, 5);
    const hit = message("assistant", "", 20, { status: "failed", error: `Claude's usage limit was reached. It resets at ${reset}.`, ended: now - 20 * min });
    thread(relay, "Refactor the store", 20, [message("user", "Split the store into one file per slice.", 22), hit],
      { limitResume: { messageId: hit.id, provider: "claude", at: now + 40 * min } });
  }
  // Background work Claude left running, and work that stopped when Relay closed.
  thread(relay, "Keep the dev server up", 11, [
    message("user", "Start the dev server and check back on the build in half an hour.", 13),
    message("assistant", "It's running in the background, and I'll check back on the build.", 11),
  ], { pending: [
    { kind: "task", id: "bash-1", description: "npm run dev", since: now - 12 * min },
    { kind: "wakeup", id: "wake-1", prompt: "Check the build", recurring: false, at: now + 25 * min },
  ] });
  thread(relay, "Babysit the migration", 90, [
    message("user", "Run the migration and watch it.", 95),
    message("assistant", "The migration runs in the background; I'll report when it's done.", 90),
  ], { stopped: { at: now - 60 * min, items: [
    { kind: "task", id: "bash-2", description: "Run the database migration", since: now - 92 * min },
    { kind: "wakeup", id: "wake-2", prompt: "Check it", recurring: true },
  ] } });
  // An old thread whose last input was kept before `choice` was: it still loads.
  threads.get(thread(relay, "From before choices", 600, [
    message("user", "Rename the build script.", 602),
    message("assistant", "Renamed it to `scripts/build.mjs`.", 600),
  ]))!.lastInput = { id: "old-input", body: "@claude Rename the build script.", provider: "claude", runtimeMode: "full-access", interactionMode: "default" };
  // A long history: the phone holds the latest 100 and loads the rest a page at a time.
  thread(relay, "A very long history", 400, Array.from({ length: 130 }, (_, i) => [
    message("user", `Note ${i + 1}: anything else?`, 1000 - i * 4),
    message("assistant", `Reply ${i + 1}.${i === 0 ? " This is the very first answer." : ""}`, 999 - i * 4),
  ]).flat());
  // Where the thread moved, setup that failed, and an answer that failed twice.
  {
    const asked = message("user", "Try the change in a worktree of its own.", 70);
    const setup = message("assistant", "", 69, { status: "failed", worktreeCommand: { kind: "setup", command: "npm ci", output: "npm ERR! code ERESOLVE\nnpm ERR! Could not resolve dependency", exitCode: 1 } });
    const done = message("assistant", "Tried it there; the change holds. Back in the project folder now.", 60);
    thread(relay, "Try the worktree flow", 60, [asked, setup, done], {
      branch: "relay/try-worktree", worktree: true,
      workspaceMoves: [
        { at: now - 70 * min, after: asked.id, how: "moved", to: "/tmp/wt/relay-try", branch: "relay/try-worktree", unasked: true, by: "claude" },
        { at: now - 60 * min, after: done.id, how: "switched" },
      ],
    });
  }
  thread(relay, "Summarise the RFC", 8, [
    message("user", "Summarise the sync RFC.", 12),
    message("assistant", "", 11, { status: "failed", signIn: "claude", error: "Not logged in · Please run /login", ended: now - 11 * min }),
    message("user", "Signed in, try again.", 9),
    message("assistant", "", 8, { status: "failed", ended: now - 8 * min,
      error: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\nTechnical details:\nrequest_id: req_011CTx' }),
  ]);
}

const summaries = () => [...threads.values()].map((t) => t.summary);
const { gitStandIn } = await import("./live-git");
const worktreeThread = [...threads.values()].find((t) => t.summary.worktree)?.summary;
const git = seeded
  ? gitStandIn({ now, relay, site, worktree: worktreeThread && { chatId: worktreeThread.id, branch: worktreeThread.branch, from: "main" } })
  : undefined;

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
const previewChat = seeded && thread(relay, "Is the preview up?", 12, [
  message("user", "Is the preview server running?", 13),
  message("assistant", `It is, at http://localhost:${devServer}/about. Have a look.`, 12),
]);

// Files, tasks, the working tree, notes and the updater (live-desktop-files.ts).
const extras = filesFixture({ seeded, root, now, min, relay, site, bridge: remoteBridgeVersion, threads: threads as any, thread, message, step, devTask, changed: (p) => changed(p) });

// Pictures by attached id, read path or preview shot, as the desktop hands them out.
const picture = async (path: string) => `data:image/png;base64,${(await readFile(join(root, path))).toString("base64")}`;
const pictures = new Map<string, string>();
if (seeded) {
  const [now1, like] = [id(), id()];
  pictures.set(now1, await picture("docs/media/relay-preview.png"));
  pictures.set(like, await picture("previews/website/public/og.png"));
  pictures.set("/tmp/relay/shots/review.png", await picture("docs/media/deep-review.png"));
  pictures.set("/tmp/relay/shots/after.png", await picture("ios/Relay/Resources/Assets.xcassets/AppIcon.appiconset/icon.png"));
  const review = step("/tmp/relay/shots/review.png", "read");
  const edit = step("src/features/home/EmptyState.tsx", "file");
  const answered = message("assistant", "Looked at both, and at the review screen for its spacing. It now reads like this:\n\n![after](shots/after.png)\n\nThe mark sits centred with the hint under it.", 5, {
    ended: now - 4 * min,
    trace: [review, edit].map((a) => ({ kind: "activity", id: a.id, activity: a })),
    preview: { url: `http://localhost:${devServer}/`, title: "Relay", at: now - 4 * min, shot: true },
  });
  pictures.set(`shot:${answered.id}`, await picture("previews/website/public/og.png"));
  thread(relay, "Make the empty state friendlier", 5, [
    message("user", "The empty state looks bare. Here's how it is now and what I'd like.", 7, {
      images: [
        { id: now1, name: "now.png", mimeType: "image/png", sizeBytes: 267246 },
        { id: like, name: "like-this.png", mimeType: "image/png", sizeBytes: 258294 },
      ],
    }),
    answered,
  ]);
}
const pictureOf = (key: string) => {
  const url = pictures.get(key);
  if (!url) throw new Error("That image isn't there any more.");
  return url;
};

// The desktop's own draft store, so writes merge as they do there. Writing
// {"key", "text"} to /tmp/relay-desktop-draft.json types it on the "computer".
const draftStore = new DesktopDrafts(join(await mkdtemp(join(tmpdir(), "relay-ios-drafts-")), "drafts.json"));
const draftChanged = (change: DraftChange | undefined) => change && remote.draftChanged(change);
if (previewChat) {
  draftStore.write({ key: previewChat, base: 0, at: now - 5 * min, text: "Also check the dark theme of", extras: { screenshots: [1] } }, "desktop");
}
// A new thread written on the computer, in its own worktree: Home lists it above the threads,
// and the phone carries on writing it.
if (seeded) {
  draftStore.write({ key: `new:${site}:fixture1`, base: 0, at: now - 3 * min, text: "Rewrite the pricing section so it reads like the compare page", workspace: "worktree" }, "desktop");
}
const desktopDraftFile = "/tmp/relay-desktop-draft.json";
watchFile(desktopDraftFile, { interval: 300 }, async () => {
  const typed = JSON.parse(await readFile(desktopDraftFile, "utf8").catch(() => "null"));
  if (!typed?.key) return;
  const before = draftStore.get(typed.key);
  draftChanged(draftStore.write({ key: typed.key, base: before?.rev ?? 0, at: Date.now(), text: typed.text ?? "", ...(before?.extras ? { extras: before.extras } : {}) }, "desktop"));
  console.error("desktop typed", JSON.stringify(typed));
});
const draftsHost = {
  list: () => draftStore.list(),
  write: (write: DraftWrite, by: DraftDevice) => {
    draftChanged(draftStore.write(write, by));
    console.error("draft write", by, JSON.stringify({ key: write.key, base: write.base, text: write.text, workspace: write.workspace, sent: write.sent }));
    return draftStore.get(write.key) ?? null;
  },
  other: (key: string, drop: boolean) => {
    draftChanged(draftStore.other(key, drop));
    return draftStore.get(key) ?? null;
  },
  holds: (key: string) => !!draftStore.get(key)?.extras,
  sendHeld: async (key: string, chatId: string | undefined, send: any) => {
    const target = chatId ?? created(projects[0].id).id;
    console.error("send held", key, target, send.body);
    sent(target, { ...send, id: send.id ?? id() });
    for (const change of draftStore.remove([key])) draftChanged({ ...change, sent: true });
    return { chatId: target };
  },
};

const host = {
  drafts: seeded ? draftsHost : undefined,
  version: extras.version,
  handoffs: extras.handoffs,
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
    if (slowNew && t.summary.empty) await pause(8000);
    // A summary says only whether there's a worktree; the thread says which.
    const worktree = t.summary.worktree ? { branch: t.summary.branch, path: `/tmp/relay-worktrees/${t.summary.branch}`, from: "main" } : undefined;
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
    if (method === "sendProjectChat" && refusing) throw new Error("The selected worktree is unavailable. Choose another workspace.");
    if (method === "selectAgentWorktree") refusing = false;
    if (method === "sendProjectChat" && slowNew && threads.get(args[0])?.summary.empty) await pause(8000);
    if (method === "sendProjectChat") sent(args[0], args[1]);
    if (method === "cancelProjectChat") stopped.add(args[0]);
    if (method === "projectChatQueueAction") queueAction(args[0], args[1], args[2], args[3]);
    if (method === "projectChatQueuedImages") return [];
    if (method === "projectChatImage") return pictureOf(args[1]);
    if (method === "projectChatReadImage") return pictureOf(args[2]);
    if (method === "projectChatPreviewShot") return pictureOf(`shot:${args[1]}`);
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
    if (method === "aiSettings") return { threadProvider: "claude", questionsProvider: "claude", ...agentPrefs };
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
    if (method === "projectTasks") return extras.tasks(args[0]);
    if (method === "projectChatAgents") return (subagents.get(args[0]) ?? []).map(({ trace: _t, report: _r, ...run }) => run);
    if (method === "projectChatAgent") return subagents.get(args[0])?.find((r) => r.id === args[1]) ?? null;
    if (method === "stopProjectChatAgent") return stopAgent(args[0], args[1]);
    if (method === "resumeProjectChat") return resumed(args[0], args[1]);
    if (method === "stopProjectChatPending") return stopPending(args[0], args[1]);
    if (method === "resolveStoppedWork") return resolveStopped(args[0], args[1]);
    if (method === "setLimitResume") return limitResume(args[0], args[1]);
    if (method === "rerunWorktreeSetup") return rerunSetup(args[0], args[1]);
    return extras.dispatch(method, args) ?? git?.(method, args);
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

function stopAgent(chatId: string, agentId: string) {
  const run = subagents.get(chatId)?.find((r) => r.id === agentId);
  if (!run) throw new Error("That agent isn't there any more.");
  if (run.status !== "running") throw new Error("That agent already finished.");
  Object.assign(run, { status: "stopped", ended: Date.now() });
  const t = threads.get(chatId)!;
  t.summary.pending = t.summary.pending?.filter((p: any) => p.id !== run.taskId);
  changed(t.summary.projectId);
}
/** Picks the stopped answer back up: a new answer streams, with no message of the user's. */
function resumed(chatId: string, settings: any) {
  const { provider, ...rest } = settings ?? {};
  answer(chatId, { id: id(), body: "Carry on where you stopped.", ...(provider ? { to: provider, ...rest } : {}) }, true);
}
function stopPending(chatId: string, itemId: string) {
  const c = threads.get(chatId)!.summary;
  c.pending = c.pending?.filter((p: any) => p.id !== itemId);
  if (!c.pending?.length) delete c.pending;
  c.updated = Date.now();
  changed(c.projectId);
}
function resolveStopped(chatId: string, action: string) {
  const t = threads.get(chatId)!;
  delete t.summary.stopped;
  t.summary.updated = Date.now();
  changed(t.summary.projectId);
  if (action === "resume") answer(chatId, { id: id(), body: "Pick the migration back up." }, true);
}
function limitResume(chatId: string, on: boolean) {
  const c = threads.get(chatId)!.summary;
  if (c.limitResume) c.limitResume = { ...c.limitResume, ...(on ? { off: undefined } : { off: true }) };
  changed(c.projectId);
}
function rerunSetup(chatId: string, messageId: string) {
  const t = threads.get(chatId)!;
  const m = t.messages.find((x) => x.id === messageId);
  Object.assign(m, { status: "complete", version: m.version + 1, worktreeCommand: { ...m.worktreeCommand, output: "added 812 packages in 9s", exitCode: 0 } });
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
  // "needs you" in a message makes another thread ask something a moment later, so the
  // phone's banner over the open thread can be seen.
  if (seeded && /needs you/i.test(send.body ?? "")) setTimeout(() => askElsewhere(chatId), 4000);
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
// Touching <pairing file>.ask does the same from outside, whatever the phone has open.
if (seeded) watchFile(`${out}.ask`, { interval: 300 }, (now) => now.mtimeMs && askElsewhere(""));
// Writing a thread's title into <pairing file>.send sends into it as if typed on the desktop.
if (seeded) watchFile(`${out}.send`, { interval: 300 }, (now) => {
  if (!now.mtimeMs) return;
  const title = readFileSync(`${out}.send`, "utf8").trim();
  const t = [...threads.values()].find((c) => c.summary.title === title);
  if (t) answer(t.summary.id, { id: id(), body: "Sent from the desktop while the phone has this open." });
});
/** The first thread other than `chatId` that isn't waiting starts waiting on a question. */
function askElsewhere(chatId: string) {
  const t = [...threads.values()].find((c) => c.summary.id !== chatId && !c.summary.waiting && !c.summary.running && !c.summary.snoozedUntil);
  if (!t) return;
  Object.assign(t.summary, { waiting: true, asking: true, updated: Date.now() });
  changed(t.summary.projectId);
  console.error("asking in", t.summary.title);
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

/** A pasted picture as the desktop keeps it, by an id of its own. */
function kept(image: { name: string; mimeType: string; dataUrl: string }) {
  const imageId = id();
  pictures.set(imageId, image.dataUrl);
  return { id: imageId, name: image.name, mimeType: image.mimeType, sizeBytes: Math.round((image.dataUrl.length * 3) / 4) };
}

/** The user's message, then a reply streamed word by word, as an agent's would. */
function answer(chatId: string, send: any, silent = false) {
  const t = threads.get(chatId);
  if (!t) return;
  stopped.delete(chatId);
  const asked = { ...message("user", send.body, 0), id: send.id, created: Date.now(), ...(send.parentId ? { parentId: send.parentId } : {}), ...(send.side ? { side: true } : {}), ...(send.images?.length ? { images: send.images.map(kept) } : {}) };
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
  if (!silent) {
    t.messages.push(asked);
    remote.chatEvent({ chatId, message: asked });
  }
  const reply = { ...message("assistant", "", 0), created: Date.now(), status: "streaming", activity: [] as any[], ...(beside ? { parentId: asked.id } : {}) };
  t.messages.push(reply);
  if (beside) Object.assign(t.summary, { updated: Date.now() });
  else Object.assign(t.summary, { running: true, runningSince: Date.now(), waiting: undefined, asking: undefined, updated: Date.now() });
  changed(t.summary.projectId);
  const on = send.choice ? `${send.to} on ${send.choice.model || "its default model"}, ${send.choice.reasoningEffort || "default"} effort${send.choice.fast ? ", fast" : ""}${send.contextWindow ? ", " + send.contextWindow : ""}` : send.to ?? t.summary.provider;
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
    if (busy && i < 24 && trace.length < (scrollStress ? 360 : 36)) {
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

// --control <file>: writing {"do": …} to it acts as the computer would. "offline" and "online"
// turn phone access off and on, keeping the pairing; "pair" writes a fresh pairing link; "wait", "run", "finish" and "fail" move the
// thread whose title contains "chat" ("finish" with "body", "fail" with "error"); "refuse" turns
// sends away as a gone worktree would, until "accept" or the phone picks the project folder.
// "agents" with "order" and "off" sets the agents' order and switches aiSettings reports.
// "send" with "body" starts a streamed answer; "steer": true interrupts the current one.
const controlAt = process.argv.indexOf("--control");
let refusing = false;
/** Settings → Agents' order and switches, as aiSettings reports them; "agents" with "order" and "off" sets them. */
let agentPrefs: { agentOrder?: string[]; agentsOff?: string[] } = {};
if (controlAt > 0) {
  const controlFile = process.argv[controlAt + 1];
  await writeFile(controlFile, "{}");
  watchFile(controlFile, { interval: 300 }, async () => {
    let order: any;
    try {
      order = JSON.parse(await readFile(controlFile, "utf8"));
    } catch {
      return console.error("control: not JSON");
    }
    const t = order.chat ? [...threads.values()].find((x) => x.summary.title.includes(order.chat)) : undefined;
    const c = t?.summary;
    console.error("control", JSON.stringify(order), c?.id ?? "");
    if (order.do === "offline") await remote.setEnabled(false);
    if (order.do === "online") await remote.setEnabled(true);
    if (order.do === "pair") await writeFile(out, (await remote.pairing()).url);
    if (order.do === "refuse") refusing = true;
    if (order.do === "accept") refusing = false;
    if (order.do === "agents") agentPrefs = { agentOrder: order.order ?? [], agentsOff: order.off ?? [] };
    if (!t || !c) return;
    if (order.do === "send") {
      sent(c.id, { id: id(), body: order.body ?? "busy", delivery: order.steer ? "steer" : "queue" });
      return;
    }
    const end = (status: string, body: string, error?: string) => {
      const reply = { ...message("assistant", body, 0), created: Date.now(), status, ...(error ? { error } : {}) };
      t.messages.push(reply);
      remote.chatEvent({ chatId: c.id, message: reply });
      Object.assign(c, { running: undefined, runningSince: undefined, updated: Date.now() });
    };
    if (order.do === "wait") Object.assign(c, { waiting: true, asking: true, updated: Date.now() });
    if (order.do === "run") Object.assign(c, { running: true, runningSince: Date.now(), waiting: undefined, asking: undefined });
    if (order.do === "finish") end("complete", order.body ?? "All done: the tests pass again.");
    if (order.do === "fail") end("failed", "", order.error ?? "Claude's login expired.");
    changed(c.projectId);
  });
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
