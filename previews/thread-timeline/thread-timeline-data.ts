// Sample thread for the timeline preview: a long afternoon of prompts, so
// the rail has to close up and the early turns sit behind "Earlier messages".
import type { AgentTrace, ChatMessage } from "../../shared/projects";

export const projectRoot = "/Users/you/code/relay";
const min = 60 * 1000;
const start = Date.now() - 6 * 60 * min;

const pairs: [prompt: string, answer: string, tools?: string[]][] = [
  [
    "The phone keeps dropping the connection when the screen turns off. Find out why.",
    "Android kills the WebSocket about **30 s after the screen goes off** because nothing holds the process in the foreground. The bridge reconnects on wake, which is the drop you see.\n\nThe fix is a foreground service with a quiet notice while the app is in the background.",
    ["Read phone/src/bridge.ts", "Searched for AppState", "Ran adb logcat"],
  ],
  [
    "ok do the foreground service",
    "Added `relay-watch`, an Expo module that starts a foreground service when the app goes to the background and stops it when it comes back. The notice reads **Connected to <computer>** and has no sound.",
    ["Edited phone/modules/relay-watch/index.ts", "Edited AndroidManifest.xml"],
  ],
  [
    "does it survive doze?",
    "Mostly. Doze still batches network access, but a foreground service is exempt from the app-standby buckets, so the socket stays up. In a 40 minute test with the screen off it never dropped.",
  ],
  [
    "what's the battery cost",
    "About **1.2% an hour** idle on the Fold7, measured with `dumpsys batterystats` over two hours. Most of it is the keep-alive ping every 25 s; stretching it to 60 s halves that.",
    ["Ran adb shell dumpsys batterystats"],
  ],
  [
    // Stopped before it wrote anything: the card says what it did.
    "make the ping 60s then",
    "",
    ["Edited phone/src/bridge.ts", "Edited electron/phone/bridge.ts"],
  ],
  [
    "Threads open slowly on the phone, like 2 seconds. why",
    "The phone asks for the whole thread and waits for it before drawing anything. On a 289-message thread that's 3.3 MB of JSON over the bridge.\n\nTwo fixes:\n\n1. Open from the cached copy at once and refresh behind it.\n2. Cut tool output to 600 characters in what the phone gets.",
    ["Read phone/src/thread.tsx", "Read electron/phone/bridge.ts"],
  ],
  [
    "do both",
    "Both are in. A cached thread now opens in about **80 ms**, and the first refresh is 41 KB instead of 3.3 MB.",
  ],
  [
    "nice. what about images",
    "Images still go whole. I'd shrink them on the desktop to the size the phone shows them and keep the full one for the lightbox.",
  ],
  [
    "yes do that",
    "Thumbnails now come at 2× the size they draw. A 3320 px screenshot's thumbnail went from 1145 KB to 69 KB.",
  ],
  [
    "Write a test for the shrink",
    "Added `images.test.ts` with a real PNG: it checks the long side lands at the asked width and that a picture already smaller comes back untouched.",
    ["Edited electron/phone/images.test.ts", "Ran vitest"],
  ],
  [
    "whats .ksh ?",
    ".ksh is a **KornShell script**, a text file of commands much like .sh. The MMI emulator uses `/bin/ksh` to run them.",
  ],
  [
    "@codex can I run them with bash",
    "Most of them, yes. KornShell and bash share the basics; watch for `print`, `typeset -A` and `[[ ]]` pattern differences.",
  ],
  [
    "The read-aloud button stutters on long answers",
    "Each sentence waits for the previous one to finish synthesising, so a long sentence leaves a gap. Synthesising one sentence ahead removes it; the worker already has room for that.",
    ["Read src/features/read-aloud/player.ts"],
  ],
  [
    "do one ahead",
    "The player now keeps one sentence ready. The longest gap on a 2,000-word answer went from 1.4 s to 90 ms.",
  ],
  [
    "should it go two ahead?",
    "No. One ahead already hides the gap, and two ahead doubles the memory and wastes work when you stop early.",
  ],
  [
    "Review the bridge 14 diff before I tag",
    "Two things worth fixing first:\n\n- `ackWindow` resets on reconnect but the phone keeps its old count, so the first 16 KB after a reconnect can stall.\n- Deflate errors are swallowed, so a bad frame looks like silence.\n\nThe rest reads fine.",
    ["Ran git diff main~3", "Read electron/phone/frames.ts"],
  ],
  [
    "fix both",
    "Fixed: both sides reset the window on reconnect, and a frame that won't inflate is logged and asks for a full copy.",
  ],
  [
    "tag it",
    "Tagged **v0.8.1** on b4d6cfb5 with the notes you saw. The mini picked it up.",
  ],
  [
    "The sidebar flickers when a thread finishes",
    "The thread list replaces itself on every summary push, so React remounts the rows. Keying on the thread id and patching in place stops it.",
  ],
  [
    "patch in place",
    "Done. Finishing a thread now changes only its row; I checked with the React profiler that nothing else renders.",
  ],
  [
    "what about the spinner",
    "The spinner pauses when the window loses focus, like the other loops in `styles.css`.",
  ],
  [
    "How big is the main bundle now",
    "4.1 MB minified, 1.2 MB gzipped. The biggest pieces are the diff viewer (31%), mermaid (18%) and the markdown pipeline (9%). Mermaid only shows up in a few answers, so it should load on demand.",
    ["Ran npm run build", "Ran source-map-explorer"],
  ],
  [
    "lazy load mermaid",
    "Mermaid now loads the first time an answer has a diagram. The main bundle dropped to 3.4 MB.",
  ],
  [
    "any visible delay?",
    "About 120 ms the first time a diagram shows, then none. The block keeps its height while it loads, so nothing jumps.",
  ],
  [
    "Dictation sometimes types the last word twice",
    "The final transcript arrives after the last partial one, and both get inserted. The partial should be replaced, not appended.",
    ["Read src/features/composer/prompt/dictation.ts"],
  ],
  [
    "replace it",
    "Fixed: the final text now replaces the last partial range instead of following it.",
  ],
  [
    "Add a shortcut to toggle dictation",
    "Added **⌥Space** through the shortcuts registry, so it shows in Settings and can be rebound.",
  ],
  [
    "why is the e2e suite flaky on the mini",
    "The worktree specs share a temp folder name, so two runs that start in the same second collide. Using `mkdtemp` gives each run its own folder.",
  ],
  [
    "fix",
    "Switched to `mkdtemp`. Ten runs back to back on the mini all passed.",
  ],
  [
    "Explain how the agent host survives a restart",
    "The host is a detached process Relay talks to over a local socket. When Relay quits, the host keeps the agents running and buffers their output; the next Relay reconnects and replays what it missed.\n\nCmd+Q stops the host too; a crash or update doesn't.",
  ],
  [
    "what if the host crashes",
    "Then the agents die with it. Relay notices on reconnect, marks the running turns as failed and offers Resume answer.",
  ],
  [
    "Can we show cost per thread",
    "Yes. Every answer already records its cost, so a thread's total is a sum. I'd put it in the header's usage menu, not the sidebar.",
  ],
  [
    "header it is",
    "The usage menu now shows the thread's cost under the context meter.",
  ],
  [
    "Make the composer remember drafts per thread",
    "Drafts now save per thread as you type and come back when you return. Sending or clearing removes them.",
    ["Edited src/features/composer/drafts.ts"],
  ],
  [
    "what about images in drafts",
    "Pasted images are kept with the draft, up to the same three a message can carry.",
  ],
  [
    "Find why typing lags in long threads",
    "Every keystroke re-rendered the thread because the composer's text lived in the chat's state. Moving it into the composer itself took typing from 22 ms to 2 ms a key in a 300-message thread.",
    ["Ran the React profiler", "Edited src/features/thread/ProjectChat.tsx"],
  ],
  [
    "great",
    "Thanks. I also checked the phone composer; it already kept its text local.",
  ],
  [
    "Add a timeline beside the thread to jump between prompts",
    "Jumping to the first turn of a 289-message thread mounts every message below it: about **310 ms** frozen. A window of 40 messages around the target costs ~70 ms however long the thread is, so I'd build the jump on that.",
  ],
  [
    "go windowed",
    "Working on it: the thread mounts a window around the turn you jump to and grows toward the latest as you scroll.",
  ],
];

let id = 0;
const trace = (tools: string[] = []): AgentTrace[] =>
  tools.map((label) => {
    const key = `t${++id}`;
    return {
      kind: "activity",
      id: key,
      activity: {
        id: key,
        kind: label.startsWith("Ran")
          ? "command"
          : label.startsWith("Edited")
            ? "file"
            : label.startsWith("Searched")
              ? "search"
              : "read",
        label,
        status: "complete",
      },
    };
  });

// ?repeat=8 makes a long thread, to see the rail packed close and what a
// jump to the start costs.
const repeat = Number(new URLSearchParams(location.search).get("repeat")) || 1;

export const sampleThread: ChatMessage[] = Array.from(
  { length: repeat },
  () => pairs,
)
  .flat()
  .flatMap(([prompt, answer, tools], i) => {
    const at = start + i * 8 * min;
    return [
      {
        id: `u${i}`,
        role: "user",
        body: prompt,
        status: "complete",
        created: at,
        provider: "claude",
        version: 1,
      },
      {
        id: `a${i}`,
        role: "assistant",
        body: answer,
        status: "complete",
        created: at + 20_000,
        ended: at + 20_000 + (tools?.length ?? 0) * 15_000 + 9_000,
        provider: "claude",
        model: { name: "Opus 5.5", effort: "high" },
        trace: trace(tools),
        version: 1,
      },
    ];
  });
