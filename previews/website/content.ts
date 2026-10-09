// The page's words, written to the ASD-STE100 structure rules: active voice,
// simple tenses, one idea per sentence, 25 words at most, one word per thing
// ("thread", never "chat" or "conversation"). Product facts follow README.md,
// docs/phone.md and shared/shortcuts.ts. Keep them in step when those change.

export const REPO = "https://github.com/relaycodehq/relay";
export const ISSUES = `${REPO}/issues`;
export const BUILD_GUIDE = `${REPO}#for-contributors`;
export const LICENSE = `${REPO}/blob/main/LICENSE`;
export const RELEASES =
  "https://github.com/relaycodehq/relay/releases/latest";
export const EMAIL = "hello@relaycode.io";
// The build sets the version from the latest v* tag (previews/website/vite.config.ts).
declare const __RELAY_VERSION__: string | undefined;
export const VERSION =
  typeof __RELAY_VERSION__ === "string" ? __RELAY_VERSION__ : "dev";
const download = (file: string) =>
  VERSION === "dev"
    ? RELEASES
    : `https://github.com/relaycodehq/relay/releases/download/v${VERSION}/${file}`;

export const releaseNotes =
  VERSION === "dev"
    ? RELEASES
    : `https://github.com/relaycodehq/relay/releases/tag/v${VERSION}`;

export const features: { title: string; text: string; detail: string }[] = [
  {
    title: "Your agents",
    text: "Relay runs Claude, Codex, OpenCode, Cursor, Amp and Antigravity. You add more from the ACP registry. You select the model and the effort for each thread.",
    detail: "model · effort",
  },
  {
    title: "Parallel threads",
    text: "Activity shows each open thread and its state. Press ⌘1–9 to open a thread.",
    detail: "⌘1–9",
  },
  {
    title: "Live steps",
    text: "Relay shows each command, file read and edit live. The steps fold when the answer arrives.",
    detail: "live trace",
  },
  {
    title: "Changes",
    text: "Changes shows the working tree next to the thread. You stage, commit and push there.",
    detail: "stage · commit · push",
  },
  {
    title: "Worktrees",
    text: "A thread can work in its own Git worktree. You merge its branch when the work is ready.",
    detail: "git worktree",
  },
  {
    title: "Terminal",
    text: "Each thread has its own terminal. Press ⌘J to show it.",
    detail: "⌘J",
  },
  {
    title: "Deep review",
    text: "Two or more models read your changes. A lead agent checks each finding. Then the lead agent fixes the confirmed findings.",
    detail: "reviewers → lead",
  },
  {
    title: "Ultraplan",
    text: "Agents on different models examine the problem. A lead agent checks their notes against the code and writes the plan.",
    detail: "council → plan",
  },
  {
    title: "Side questions",
    text: "Type /btw to ask a side question. The main session does not get it. Scratchpad holds threads without a project.",
    detail: "/btw · ⌘⇧N",
  },
  {
    title: "Pull requests",
    text: "The Pull requests page shows comments and review progress, on GitHub or Gitea. The title bar shows CI status for GitHub and Gitea.",
    detail: "Gitea · GitHub CI",
  },
  {
    title: "Limits",
    text: "Meters show the usage that remains for Claude and Codex. One meter is for the session. One meter is for the week.",
    detail: "session · week",
  },
  {
    title: "Themes and shortcuts",
    text: "Relay has built-in themes and accepts VS Code themes from Open VSX. You can change the fonts, the sizes and each shortcut.",
    detail: "Open VSX",
  },
];

export const promises: { title: string; text: string }[] = [
  {
    title: "No API keys",
    text: "Relay contains no agent and no API key. Each agent runs through its own CLI and your account.",
  },
  {
    title: "Local data",
    text: "Threads, drafts and settings stay on your computer. The OS credential store encrypts saved tokens.",
  },
  {
    title: "Your Git",
    text: "Relay does not check out, reset, pull, force-push or stage files by itself. A Git action occurs only when you click it.",
  },
  {
    title: "Open source",
    text: "The code is on GitHub under the MIT license. You can read it, change it and share it.",
  },
];

export type Build = {
  system: string;
  file: string;
  href: string;
  status: string;
  /** Which visitors this build is for; see live.ts. */
  os?: "mac" | "win" | "linux" | "android";
};

export const platforms: Build[] = [
  {
    os: "mac",
    system: "macOS (Apple Silicon)",
    file: `Relay-${VERSION}-mac-arm64.dmg`,
    href: download(`Relay-${VERSION}-mac-arm64.dmg`),
    status: "Primary platform. Used each day.",
  },
  {
    os: "win",
    system: "Windows 10/11 (x64)",
    file: `Relay-${VERSION}-win-x64.exe`,
    href: download(`Relay-${VERSION}-win-x64.exe`),
    status: "Built with each release. Less use.",
  },
  {
    os: "linux",
    system: "Linux (x86-64)",
    file: `Relay-${VERSION}-linux-x86_64.AppImage`,
    href: download(`Relay-${VERSION}-linux-x86_64.AppImage`),
    status: "Cross-built. Few runtime tests.",
  },
  {
    system: "Omarchy",
    file: `Relay-${VERSION}-omarchy-x86_64.tar.gz`,
    href: download(`Relay-${VERSION}-omarchy-x86_64.tar.gz`),
    status: "Run python3 install.py. No sudo.",
  },
];

/** Builds outside the desktop list: the phone app. */
export const otherBuilds: Build[] = [
  {
    os: "android",
    system: "Android phone app",
    file: "Relay-Android.apk",
    href: download("Relay-Android.apk"),
    status: "Follow and answer threads from your phone.",
  },
];

export const HEADLESS_GUIDE = `${REPO}/blob/main/docs/headless.md`;

/** The headless Relay's one-line installs, which also run its setup. */
export const headlessInstall: { system: string; command: string }[] = [
  {
    system: "macOS and Linux",
    command: "curl -fsSL https://relaycode.io/install.sh | sh",
  },
  {
    system: "Windows, in PowerShell",
    command: "irm https://relaycode.io/install.ps1 | iex",
  },
];

/** What to do after the download. The builds have no code signature yet. */
export const firstStart: {
  system: string;
  text: string;
  /** The terminal route to the same end, for those who prefer it. */
  command?: string;
}[] = [
  {
    system: "macOS",
    text: "Move Relay to Applications. At the first start, macOS cannot verify the app. Open System Settings → Privacy & Security and click Open Anyway. Or clear the quarantine flag in Terminal:",
    command: "xattr -cr /Applications/Relay.app",
  },
  {
    system: "Windows",
    text: "SmartScreen shows “Windows protected your PC”. Click More info, then Run anyway.",
  },
  {
    system: "Linux",
    text: "Make the AppImage executable. Some distributions also need their FUSE package.",
    command: `chmod +x Relay-${VERSION}-linux-x86_64.AppImage`,
  },
];

export const steps: string[] = [
  "Sign in to one agent CLI: Claude Code, Codex, OpenCode or Amp. Relay installs a missing CLI. Settings → AI models adds Cursor, Antigravity and ACP agents.",
  "Open Relay and add a project folder.",
  "Type a task, select the agent and the model, and press Send.",
];

export const openSource: {
  title: string;
  text: string;
  href: string;
  link: string;
}[] = [
  {
    title: "Read the code",
    text: "The desktop app, the phone app and the server are in one repository.",
    href: REPO,
    link: "relaycodehq/relay",
  },
  {
    title: "Report a problem",
    text: "Open an issue. Write the steps, your platform and your Relay version.",
    href: ISSUES,
    link: "Issues",
  },
  {
    title: "Build it yourself",
    text: "Clone the repository, then run npm ci and npm run dev. You need Node.js 22.",
    href: BUILD_GUIDE,
    link: "Build guide",
  },
  {
    title: "Send a change",
    text: "Fork the repository and open a pull request. Small changes with one purpose are easy to review.",
    href: `${REPO}/pulls`,
    link: "Pull requests",
  },
];

export const faq: { q: string; a: string }[] = [
  {
    q: "Which agents does Relay run?",
    a: "Relay runs Claude Code, Codex, OpenCode, Cursor, Amp and Google's Antigravity. Settings → AI models adds any agent from the ACP registry. You sign in with your own subscription.",
  },
  {
    q: "Do I need a Relay account or an API key?",
    a: "No. Relay runs the agents on your computer with your subscriptions.",
  },
  {
    q: "How do threads stay separate?",
    a: "Give a thread its own Git worktree. The thread then works on its own branch in its own folder.",
  },
  {
    q: "How does the phone connect?",
    a: "The phone app is for Android only. The computer and the phone must be on the same Tailscale network. You scan a pairing code from Settings → Phone. Relay encrypts each connection.",
  },
  {
    q: "Do I need GitHub or Gitea?",
    a: "Only for pull requests. GitHub ones work through your gh CLI login; a Gitea server can be connected in Settings. Everything else works with a local folder.",
  },
  {
    q: "Which platforms does Relay support?",
    a: "Relay is built and used each day on macOS (Apple Silicon). Each release also has Windows and Linux builds. These builds get less use.",
  },
  {
    q: "Is Relay open source?",
    a: "Yes. The code is on GitHub under the MIT license. Issues and pull requests are welcome.",
  },
  {
    q: "How do I contact the team?",
    a: `Send an email to ${EMAIL}. For a bug, open an issue on GitHub.`,
  },
  {
    q: "Is Relay finished?",
    a: "No. Relay is an early preview. The builds have no code signature. The first start on macOS and Windows needs one more click.",
  },
];
