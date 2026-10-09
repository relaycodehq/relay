// A throwaway desktop Relay for the phone app to pair with: a git project, the
// fixture agent as `codex`, phone access on. Prints the pairing link as JSON
// and runs until interrupted. Build first (vite build + build-electron).
//
//   node tests/fixtures/phone-desktop.mjs [--host 10.0.2.2] [--port 47900] [--seed] [--claude]
//
// --host replaces the link's addresses, e.g. with the Android emulator's alias
// for this computer. --seed starts two threads so the phone has something to show.
// --claude puts a stand-in Claude on the PATH, listing models as the CLI does,
// and starts a thread last sent on "opus[1m]".
// --images starts one whose answer embeds two screenshots, a missing file and a web image.
// --theme <id> wears one of src/lib/themes' dark themes, e.g. tokyo-night.
// --name <name> and --version <x.y.z> stand in for the computer's own, so two
// of these can pass for two computers, one of them behind the phone.
// RELAY_DICTATION_MODEL=<folder with the files in shared/dictation.ts> lets
// the phone dictate. RELAY_READ_ALOUD_MODELS=<a Relay's models folder> lends
// it the read-aloud voices downloaded there.
import { _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const host = arg("--host");
const port = arg("--port") ?? "47900";
const seed = process.argv.includes("--seed");
const claude = process.argv.includes("--claude");
const images = process.argv.includes("--images");
const theme = arg("--theme");
const name = arg("--name");
const version = arg("--version");

const root = await realpath(
  await mkdtemp(join(tmpdir(), "relay-phone-desktop-")),
);
const repo = join(root, "project"),
  bin = join(root, "bin");
await mkdir(join(repo, "src"), { recursive: true });
await mkdir(bin);
const git = (...args) => execFileSync("git", ["-C", repo, ...args]);
execFileSync("git", ["init", "-q", "-b", "main", repo]);
await writeFile(join(repo, "README.md"), "# Cache demo\n\nA small project.\n");
await writeFile(
  join(repo, "src", "cache.ts"),
  "export const cache = new Map<string, string>();\n",
);
git("add", ".");
git(
  "-c",
  "user.name=Relay",
  "-c",
  "user.email=relay@example.com",
  "commit",
  "-qm",
  "Start",
);
await writeFile(
  join(bin, "codex"),
  `#!${process.execPath}\n` +
    (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
  { mode: 0o700 },
);

// Through fakeCli, which answers --version: a silent stand-in loses to the real CLI.
if (claude) {
  const { fakeCli } = await import("./fake-cli.ts");
  await fakeCli(
    join(bin, "claude"),
    await readFile(resolve("tests/fixtures/slow-claude.cjs"), "utf8"),
  );
}
// What Claude Code lists: aliases standing for full ids, no `[1m]` rows.
const claudeModels = [
  [
    "opus",
    "Opus 5.5",
    "claude-opus-5-5",
    "For complex work and everyday tasks",
  ],
  [
    "sonnet",
    "Sonnet 5.5",
    "claude-sonnet-5-5",
    "Most efficient for simpler tasks",
  ],
  ["haiku", "Haiku 5.5", "claude-haiku-5-5", "Fastest for quick answers"],
].map(([value, displayName, resolvedModel, description]) => ({
  value,
  displayName,
  resolvedModel,
  description,
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
}));

const modelDir = process.env.RELAY_DICTATION_MODEL;
if (modelDir) {
  const { dictationModel } = await import("../../shared/dictation.ts");
  const model = join(root, "data", "models", dictationModel.id);
  await mkdir(model, { recursive: true });
  for (const file of dictationModel.files)
    await symlink(join(modelDir, file.name), join(model, file.name));
  await writeFile(
    join(model, "verified.json"),
    JSON.stringify(dictationModel.files.map((file) => file.sha256)),
  );
}

const voices = process.env.RELAY_READ_ALOUD_MODELS;
if (voices) {
  const { readdir } = await import("node:fs/promises");
  await mkdir(join(root, "data", "models"), { recursive: true });
  for (const engine of await readdir(voices))
    await symlink(join(voices, engine), join(root, "data", "models", engine));
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) =>
      k !== "ELECTRON_RUN_AS_NODE" && k !== "RELAY_DEV_URL" && v !== undefined,
  ),
);
const app = await electron.launch({
  args: ["tests/fixtures/launch.cjs"],
  env: {
    ...env,
    PATH: bin + ":" + env.PATH,
    RELAY_TEST_DATA: join(root, "data"),
    RELAY_TEST_HEADED: "0",
    RELAY_TEST_NATIVE_STORAGE: "0",
    RELAY_REMOTE_PORT: port,
    // No Tailscale here: loopback stands in for the tailnet; the emulator
    // reaches it as 10.0.2.2.
    RELAY_REMOTE_TAILNET: "127.0.0.1",
    RELAY_AGENT_TURN_MS: process.env.RELAY_AGENT_TURN_MS ?? "1500",
    SLOW_CLAUDE_MS: "20",
    SLOW_CLAUDE_MODELS: JSON.stringify(claudeModels),
  },
});
const stop = async () => {
  await app.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (name || version)
  await app.evaluate(
    ({ app }, { name, version }) => {
      if (version) app.getVersion = () => version;
      if (name) process.mainModule.require("node:os").hostname = () => name;
    },
    { name, version },
  );
const page = await app.firstWindow();
if (theme) {
  await page.evaluate((theme) => {
    localStorage.setItem(
      "relay-appearance",
      JSON.stringify({
        mode: "dark",
        light: { theme: "relay" },
        dark: { theme },
      }),
    );
  }, theme);
  await page.reload();
}
await app.evaluate(({ dialog }, repo) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] });
}, repo);
if (images) {
  await mkdir(join(repo, "docs"));
  await writeFile(join(repo, "docs", "shot.png"), await page.screenshot());
  // A tall one too, which narrows in the thread instead of running long.
  await writeFile(
    join(repo, "docs", "sidebar.png"),
    await page.screenshot({ clip: { x: 0, y: 0, width: 280, height: 700 } }),
  );
}
const pairing = await page.evaluate(
  async ({ seed, images, claude }) => {
    const project = await window.relay.addProject();
    if (claude) {
      // Last sent on Claude's 1M window, as the desktop keeps it: "opus[1m]".
      const chat = await window.relay.createProjectChat(project.id, {
        kind: "project",
      });
      await window.relay.sendProjectChat(chat.id, {
        id: crypto.randomUUID(),
        body: "@claude Count to twenty",
        provider: "claude",
        choice: { model: "opus[1m]", reasoningEffort: "", fast: false },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
    }
    if (seed || images) {
      const settings = await window.relay.aiSettings();
      const start = async (body) => {
        const chat = await window.relay.createProjectChat(project.id, {
          kind: "project",
        });
        await window.relay.sendProjectChat(chat.id, {
          id: crypto.randomUUID(),
          body: "@codex " + body,
          provider: "codex",
          choice: settings.questions,
          runtimeMode: "full-access",
          interactionMode: "default",
        });
        return chat.id;
      };
      if (images)
        await start(
          "fixture echo: Before ![](docs/missing.png) after:\n\n" +
            "![the welcome screen](docs/shot.png)\n\n" +
            "![the sidebar](docs/sidebar.png)\n\n" +
            "And a web one, ![logo](https://example.com/logo.png), stays a link.",
        );
      if (seed) {
        await start("fixture edit files in the cache");
        await new Promise((r) => setTimeout(r, 2500));
        await start("fixture stream long answer about the cache guard");
      }
    }
    await window.relay.setPhoneRemote(true);
    return window.relay.phonePairing();
  },
  { seed, images, claude },
);
let url = pairing.url;
if (host) {
  const u = new URL(url);
  u.searchParams.set("h", host);
  url = u.toString();
}
console.log(JSON.stringify({ url, data: join(root, "data"), repo }));
