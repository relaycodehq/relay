// A browser tab has no preload bridge. Previews import this first so the
// app's own components can run on sample data. Add calls as previews need
// them; anything missing throws, so a gap shows up instead of hanging.
import type { Api } from "../../shared/types";
import { fallbackCodexModels, type ClaudeModel } from "../../shared/settings";
import { fetchThemes, searchThemes } from "../../shared/open-vsx";
import { releaseNotesFrom, releasesApi } from "../../shared/updates";
import type { WatchScope } from "../../shared/watch";

const claudeModels: ClaudeModel[] = [
  {
    id: "claude-opus-5-5",
    name: "Opus 5.5",
    description: "Most capable for complex work",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    longContext: true,
  },
  {
    id: "claude-sonnet-5",
    name: "Sonnet 5",
    description: "Fast and capable for everyday work",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    longContext: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Haiku 4.5",
    description: "Fastest for quick answers",
    efforts: ["low", "medium", "high"],
    longContext: false,
  },
];

// Previews open in the dark Dracula theme the desktop app usually runs;
// the colour toggle keeps whatever you pick after that.
if (!localStorage.getItem("relay-appearance"))
  localStorage.setItem(
    "relay-appearance",
    JSON.stringify({
      mode: "dark",
      light: { theme: "relay" },
      dark: { theme: "dracula" },
    }),
  );

const hour = 60 * 60 * 1000;
let smartProjectNames =
  localStorage.getItem("preview-smart-project-names") !== "false";
const stub: Partial<Api> = {
  smartProjectNames: async () => smartProjectNames,
  saveSmartProjectNames: async (enabled) => {
    localStorage.setItem("preview-smart-project-names", String(enabled));
    return (smartProjectNames = enabled);
  },
  saveSidebarView: async () => {},
  agentModels: (async (provider: string) =>
    provider === "claude"
      ? claudeModels
      : provider === "codex"
        ? fallbackCodexModels
        : []) as Api["agentModels"],
  // A browser tab can't zoom itself; CSS zoom stands in for the window's.
  setInterfaceScale: async (scale) => {
    document.documentElement.style.zoom = String(scale);
  },
  // Open VSX allows any origin, so previews talk to the real thing.
  searchThemes: (query, offset) => searchThemes(query, offset),
  fetchThemes: (extension) => fetchThemes(extension),
  // So does GitHub's API: the changelog shows the real releases.
  releaseNotes: async () =>
    releaseNotesFrom(await (await fetch(releasesApi)).json()),
  // No repository icons in a preview; the letter badge stands in.
  projectIcon: async () => null,
  // A watch note closes in the turn; there's no saved chat to update.
  closeWatchNote: async () => {},
  watchThreads: async () =>
    (localStorage.getItem("preview-watch-threads") ?? "off") as WatchScope,
  saveWatchThreads: async (scope) => {
    localStorage.setItem("preview-watch-threads", scope);
    return scope;
  },
  // Sample week of side checks on Opus 5.5 threads.
  watchSpend: async () => {
    const thread = (
      chatId: string,
      title: string,
      checks: number,
      notes: number,
      usd: number,
      threadUsd: number,
      split: number,
      subagentChecks: number,
    ) => ({
      chatId,
      title,
      checks,
      notes,
      usd,
      threadUsd,
      split,
      subagentChecks,
      unpriced: 0,
      tokens: {
        cacheRead: checks * 118_000,
        cacheWrite: checks * 900,
        input: checks * 1_400,
        output: checks * 260,
      },
    });
    const threads = [
      thread("t1", "Fix flaky checkout tests", 14, 2, 0.41, 6.9, 9, 5),
      thread(
        "t2",
        "Website: usage scrubber + hero film",
        11,
        2,
        0.33,
        4.8,
        6,
        0,
      ),
      thread("t3", "Phone outbox retries", 6, 1, 0.16, 2.2, 3, 2),
      thread("t4", "Settings → Projects page", 3, 0, 0.07, 1.1, 1, 0),
    ];
    const sum = (pick: (t: (typeof threads)[number]) => number) =>
      threads.reduce((total, t) => total + pick(t), 0);
    return {
      days: 7,
      checks: sum((t) => t.checks),
      notes: sum((t) => t.notes),
      usd: sum((t) => t.usd),
      threadUsd: sum((t) => t.threadUsd),
      threads,
    };
  },
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  providerUsage: async (provider) => ({
    provider,
    message: null,
    windows: [
      {
        kind: "session",
        usedPercent: 35,
        resetsAt: Date.now() + 3 * hour,
        periodMs: 5 * hour,
      },
      {
        kind: "weekly",
        usedPercent: 17,
        resetsAt: Date.now() + 90 * hour,
        periodMs: 168 * hour,
      },
    ],
  }),
};

window.relay = new Proxy(stub as Api, {
  get(target, key) {
    if (key in target) return target[key as keyof Api];
    return () =>
      Promise.reject(new Error(`Preview has no stub for ${String(key)}`));
  },
});
