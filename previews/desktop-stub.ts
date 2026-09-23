// A browser tab has no preload bridge. Previews import this first so the
// app's own components can run on sample data. Add calls as previews need
// them; anything missing throws, so a gap shows up instead of hanging.
import type { Api } from "../shared/types";
import { fallbackCodexModels, type ClaudeModel } from "../shared/settings";

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
const stub: Partial<Api> = {
  claudeModels: async () => claudeModels,
  codexModels: async () => fallbackCodexModels,
  // No repository icons in a preview; the letter badge stands in.
  projectIcon: async () => null,
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
