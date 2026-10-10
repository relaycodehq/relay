import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { screenshot } from "../fixtures/screenshot";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

// Sounds stay off until picked; a pick plays when a thread finishes, a project
// can keep its own threads quiet, and a file of your own joins the choices.
test.setTimeout(90_000);

/** A short sine as a 16-bit mono WAV. */
function wav(seconds: number, freq = 880, rate = 22050) {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000),
      44 + i * 2,
    );
  return data;
}

test("thread sounds: off until picked, quiet per project, and files of your own", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-sounds-")));
  const data = join(root, "data");
  await mkdir(join(data, "project-chats"), { recursive: true });
  const path = join(root, "web-store");
  execFileSync("git", ["init", "-q", "-b", "main", path]);
  const project = {
    id: randomUUID(),
    path,
    name: "web-store",
    repository: null,
    added: 1,
  };
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      sidebarView: "threads",
      projects: [project],
      chats: [],
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(
      page.getByRole("button", { name: "Project actions for Web Store" }),
    ).toBeVisible();
    // Each built-in sound runs through one compressor.
    await page.evaluate(() => {
      const w = window as unknown as { played: number };
      w.played = 0;
      const proto = AudioContext.prototype;
      const compressor = proto.createDynamicsCompressor;
      proto.createDynamicsCompressor = function (this: BaseAudioContext) {
        w.played++;
        return compressor.call(this);
      };
    });
    const played = () =>
      page.evaluate(() => (window as unknown as { played: number }).played);

    /** A thread of the project that runs, then finishes, as the main process pushes lists. */
    const finishTurn = async () => {
      const chat = {
        id: randomUUID(),
        projectId: project.id,
        title: "Fix the cart total",
        scope: { kind: "project" },
        created: Date.now(),
        updated: Date.now(),
        provider: "claude",
      };
      const push = (patch: object) =>
        app.evaluate(
          ({ BrowserWindow }, payload) =>
            BrowserWindow.getAllWindows()[0]!.webContents.send(
              "relay:project-chats",
              payload,
            ),
          {
            projectId: project.id,
            chats: [{ ...chat, ...patch }],
          },
        );
      await push({ running: true });
      await push({ running: false, updated: Date.now() + 1 });
      // Past the gathering and the rest between two sounds.
      await page.waitForTimeout(1800);
    };

    // Off until someone picks one.
    await finishTurn();
    expect(await played()).toBe(0);

    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Comma" : "Control+Comma",
    );
    await settings
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Sounds" })
      .click();
    await expect(
      settings.getByRole("combobox", { name: "Done", exact: true }),
    ).toHaveText(/No sound/);
    await settings.getByRole("combobox", { name: "Done", exact: true }).click();
    await page.getByRole("option", { name: "Glass", exact: true }).click();
    // Picking it plays it.
    await expect.poll(played).toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.relay.soundSettings()))
      .toEqual({ finished: "glass" });

    // A file of your own joins every event's choices.
    await settings.locator('input[type="file"]').setInputFiles({
      name: "door ping.wav",
      mimeType: "audio/wav",
      buffer: wav(0.3),
    });
    await expect(settings.locator(".custom-sound")).toHaveText("door ping");
    expect(await readdir(join(data, "sounds"))).toHaveLength(1);
    await settings.getByRole("combobox", { name: "Needs you" }).click();
    await expect(page.getByRole("option", { name: /door ping/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await screenshot(page, {
      path: "test-results/screenshots/sound-settings.png",
    });
    await settings.getByRole("button", { name: "Back to app" }).click();

    await finishTurn();
    expect(await played()).toBe(2);

    // The project keeps its threads quiet.
    await page
      .getByRole("button", { name: "Project actions for Web Store" })
      .click();
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    const done = settings.getByRole("combobox", { name: "Done", exact: true });
    await expect(done).toHaveText(/Like the app \(glass\)/);
    await done.click();
    await page.getByRole("option", { name: "No sound", exact: true }).click();
    await screenshot(page, {
      path: "test-results/screenshots/project-sound-settings.png",
    });
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.relay.projects()).find((p) => p.id === id)?.settings,
          project.id,
        ),
      )
      .toEqual({ sounds: { finished: "off" } });
    await settings.getByRole("button", { name: "Back to app" }).click();
    await finishTurn();
    expect(await played()).toBe(2);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("with its window closed, Relay in the menubar still plays a thread's sound", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-sounds-")));
  const data = join(root, "data"),
    bin = join(root, "bin"),
    repo = join(root, "web-store");
  await mkdir(join(data, "project-chats"), { recursive: true });
  await mkdir(bin);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await fakeCli(
    join(bin, "claude"),
    await readFile(resolve("tests/fixtures/slow-claude.cjs"), "utf8"),
  );
  const projectId = randomUUID();
  const chat = {
    id: randomUUID(),
    projectId,
    title: "Count it out",
    scope: { kind: "project" },
    created: Date.now() - 60_000,
    updated: Date.now() - 50_000,
    messages: [
      {
        id: "u0",
        role: "user",
        provider: "claude",
        status: "complete",
        body: "hello",
        created: Date.now() - 60_000,
        version: 1,
      },
    ],
  };
  await writeFile(
    join(data, "project-chats", chat.id + ".json"),
    JSON.stringify(chat),
  );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      sidebarView: "threads",
      projects: [
        {
          id: projectId,
          path: repo,
          name: "web-store",
          repository: null,
          added: 1,
        },
      ],
      chats: [{ ...chat, messages: undefined, provider: "claude" }],
      sounds: { finished: "glass" },
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      SLOW_CLAUDE_MS: "150",
      RELAY_TEST_DATA: data,
      RELAY_TEST_SOUND: "1",
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.getByText("Count it out", { exact: true }).first().click();
    const input = page.getByLabel("Message project");
    await input.fill("@claude Count to twenty");
    await input.press("Enter");
    await expect(
      page.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();

    // Every window from here on reports whether it makes a sound.
    await app.evaluate(({ app: electronApp }) => {
      const g = globalThis as unknown as { audible: string[] };
      g.audible = [];
      electronApp.on("browser-window-created", (_e, win) =>
        win.webContents.on("audio-state-changed", (e) => {
          if (e.audible) g.audible.push(win.webContents.getURL());
        }),
      );
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.close(),
    );
    await expect
      .poll(
        () =>
          app.evaluate(
            () => (globalThis as unknown as { audible: string[] }).audible,
          ),
        { timeout: 20_000 },
      )
      .toEqual([expect.stringContaining("?sounds")]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
