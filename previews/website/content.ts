// The page's words, written to the ASD-STE100 structure rules: active voice,
// simple tenses, one idea per sentence, 25 words at most, one word per thing
// ("thread", never "chat" or "conversation"). Product facts follow README.md,
// docs/phone.md and shared/shortcuts.ts. Keep them in step when those change.

export const RELEASES = "https://github.com/lubomirmolin/relay-releases/releases/latest";
// The build sets the version from the latest v* tag (previews/website/vite.config.ts).
declare const __RELAY_VERSION__: string | undefined;
export const VERSION = typeof __RELAY_VERSION__ === "string" ? __RELAY_VERSION__ : "dev";
const download = (file: string) =>
  VERSION === "dev" ? RELEASES : `https://github.com/lubomirmolin/relay-releases/releases/download/v${VERSION}/${file}`;

export const macDownload = download(`Relay-${VERSION}-mac-arm64.dmg`);

export const features: { title: string; text: string; detail: string }[] = [
  {
    title: "Four agents",
    text: "Relay runs Claude, Codex, OpenCode and Cursor. You select the model and the effort for each thread.",
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
    text: "The inbox shows comments and review progress. The inbox needs a Gitea server. The title bar shows CI status for GitHub and Gitea.",
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
    title: "MIT license",
    text: "You can use, change and distribute Relay. Relay needs no account.",
  },
];

export const platforms: { system: string; file: string; href: string; status: string }[] = [
  {
    system: "macOS (Apple Silicon)",
    file: `Relay-${VERSION}-mac-arm64.dmg`,
    href: download(`Relay-${VERSION}-mac-arm64.dmg`),
    status: "Primary platform. Used each day.",
  },
  {
    system: "Windows 10/11 (x64)",
    file: `Relay-${VERSION}-win-x64.exe`,
    href: download(`Relay-${VERSION}-win-x64.exe`),
    status: "Built with each release. Less use.",
  },
  {
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

export const faq: { q: string; a: string }[] = [
  {
    q: "Which agents does Relay run?",
    a: "Relay runs Claude Code, Codex, OpenCode and Cursor. Install one of the CLIs and sign in. For Cursor, Settings → AI models downloads the Cursor SDK.",
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
    q: "What needs Gitea?",
    a: "Pull request review and shared threads need a Gitea server. All other functions work with a local folder.",
  },
  {
    q: "Which platforms does Relay support?",
    a: "Relay is built and used each day on macOS (Apple Silicon). Each release also has Windows and Linux builds. These builds get less use. For an Intel Mac, build Relay from source.",
  },
  {
    q: "Is Relay finished?",
    a: "No. Relay is an early preview. The builds have no code signature. The first start on macOS and Windows needs one more click.",
  },
];
