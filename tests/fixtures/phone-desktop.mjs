// A throwaway desktop Relay for the phone app to pair with: a git project, the
// fixture agent as `codex`, phone access on. Prints the pairing link as JSON
// and runs until interrupted. Build first (vite build + build-electron).
//
//   node tests/fixtures/phone-desktop.mjs [--host 10.0.2.2] [--port 47900] [--seed]
//
// --host replaces the link's addresses, e.g. with the Android emulator's alias
// for this computer. --seed starts two threads so the phone has something to show.
// --theme <id> wears one of src/lib/themes' dark themes, e.g. tokyo-night.
// RELAY_DICTATION_MODEL=<folder with the files in shared/dictation.ts> lets
// the phone dictate.
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
const theme = arg("--theme");

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
  },
});
const stop = async () => {
  await app.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

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
const pairing = await page.evaluate(
  async ({ seed }) => {
    const project = await window.relay.addProject();
    if (seed) {
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
      await start("fixture edit files in the cache");
      await new Promise((r) => setTimeout(r, 2500));
      await start("fixture stream long answer about the cache guard");
    }
    await window.relay.setPhoneRemote(true);
    return window.relay.phonePairing();
  },
  { seed },
);
let url = pairing.url;
if (host) {
  const u = new URL(url);
  u.searchParams.set("h", host);
  url = u.toString();
}
console.log(JSON.stringify({ url, data: join(root, "data"), repo }));
