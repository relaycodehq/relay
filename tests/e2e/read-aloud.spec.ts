import { test, expect, _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { screenshot } from "../fixtures/screenshot";

type Heard = { type: string; id: number; samples: number; error?: string };
declare global {
  interface Window {
    heard: Heard[];
  }
}

// The real engines are big downloads, so this runs a stand-in that plays a
// tone (tests/fixtures/read-aloud-engine.cjs) through the real worker,
// service, download code and onnxruntime.
test("downloads a voice engine and reads answers aloud through its worker", async () => {
  test.setTimeout(150000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-read-"))),
    data = join(root, "data"),
    bin = join(root, "bin"),
    log = join(root, "engine.log");
  await mkdir(bin);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  // Served slowly, so the download's progress shows.
  const model = Buffer.concat([
    Buffer.from("fake model"),
    Buffer.alloc(2_000_000, 7),
  ]);
  const server = createServer((req, res) => {
    if (req.url !== "/tone.bin") return res.writeHead(404).end();
    res.writeHead(200, { "content-length": model.length });
    let at = 0;
    const timer = setInterval(() => {
      res.write(model.subarray(at, (at += 100_000)));
      if (at >= model.length) {
        clearInterval(timer);
        res.end();
      }
    }, 60);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
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
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_TEST_READ_ALOUD_ENGINE: resolve(
        "tests/fixtures/read-aloud-engine.cjs",
      ),
      RELAY_TEST_READ_ALOUD_FILES: JSON.stringify([
        {
          name: "tone.bin",
          url: `http://127.0.0.1:${port}/tone.bin`,
          size: model.length,
          sha256: createHash("sha256").update(model).digest("hex"),
        },
      ]),
      RELAY_TEST_READ_ALOUD_LOG: log,
      RELAY_TEST_READ_ALOUD_IDLE_MS: "2500",
    },
  });
  const engineLog = () => readFile(log, "utf8").catch(() => "");
  const loads = async () =>
    (await engineLog()).split("\n").filter((l) => l === "load").length;
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByText("Your project. Your conversation."),
    ).toBeVisible();

    // Settings → Read aloud: download the engine, pick a voice and a speed.
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .first()
      .click();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("button", { name: "Read aloud", exact: true })
      .click();
    const engine = settings.getByRole("region", { name: "Test tone" });
    await expect(engine).toContainText("A sine wave by the read aloud spec");
    await engine.getByRole("button", { name: "Download" }).click();
    await expect(engine.getByRole("status")).toContainText(" of 2 MB");
    await screenshot(page, {
      path: "test-results/screenshots/read-aloud-downloading.png",
    });
    await expect(engine.getByRole("button", { name: "Delete" })).toBeVisible();
    await settings
      .getByRole("combobox", { name: "Voice", exact: true })
      .click();
    await page.getByRole("option", { name: /High hum/ }).click();
    await settings.getByRole("combobox", { name: "Speed" }).click();
    await page.getByRole("option", { name: "1.5×" }).click();
    await expect(settings.getByRole("combobox", { name: "Speed" })).toHaveText(
      "1.5×",
    );
    await screenshot(page, {
      path: "test-results/screenshots/read-aloud-settings.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Back to app" }).click();
    await expect(settings).toHaveCount(0);

    await page.evaluate(() => {
      window.heard = [];
      window.relay.onReadAloud((e) =>
        window.heard.push({
          type: e.type,
          id: e.id,
          samples: e.type === "audio" ? e.pcm.length : 0,
          ...(e.type === "end" && e.error ? { error: e.error } : {}),
        }),
      );
    });
    const heard = () => page.evaluate(() => window.heard);

    const ask = async (text: string) => {
      const before = await page.locator(".project-message.assistant").count();
      await page.getByLabel("Message project").fill(`fixture echo: ${text}`);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const answer = page.locator(".project-message.assistant").nth(before);
      await expect(answer).toContainText(text.slice(-12));
      await expect(answer.locator(".message-actions")).not.toHaveAttribute(
        "inert",
      );
      return answer;
    };
    await page.keyboard.press("ControlOrMeta+Shift+N");
    const short = await ask(
      "One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.",
    );

    // Read to the end. The tone lasts a tenth of a second a word, and 1.5×
    // makes it two thirds as long, to the sample.
    await short.hover();
    await short.getByRole("button", { name: "Read aloud" }).click();
    await expect(
      short.getByRole("button", { name: "Stop reading" }),
    ).toBeVisible();
    await screenshot(short, {
      path: "test-results/screenshots/read-aloud-playing.png",
    });
    await expect(short.getByRole("button", { name: "Read aloud" })).toBeVisible(
      {
        timeout: 15000,
      },
    );
    let events = await heard();
    expect(events.at(-1)).toMatchObject({ type: "end" });
    expect(events.at(-1)?.error).toBeUndefined();
    const words = (await engineLog())
      .split("\n")
      .filter((l) => l.startsWith("speak high "))
      .reduce((n, l) => n + l.split(/\s+/).length - 2, 0);
    expect(events.reduce((sum, e) => sum + e.samples, 0)).toBe(
      Math.round((words * 2400) / 1.5),
    );
    expect(await engineLog()).toContain(
      "speak high One two three four five six seven eight nine ten.",
    );
    expect(await loads()).toBe(1);

    // Starting another answer stops the first; Stop stops the second.
    const long = await ask(
      Array.from(
        { length: 12 },
        (_, i) => `Sentence ${i} has a few more words in it.`,
      ).join(" "),
    );
    await long.hover();
    await long.getByRole("button", { name: "Read aloud" }).click();
    await expect(
      long.getByRole("button", { name: "Stop reading" }),
    ).toBeVisible();
    await short.hover();
    await short.getByRole("button", { name: "Read aloud" }).click();
    await expect(
      long.getByRole("button", { name: "Read aloud" }),
    ).toBeVisible();
    await expect(
      short.getByRole("button", { name: "Stop reading" }),
    ).toBeVisible();
    await short.getByRole("button", { name: "Stop reading" }).click();
    await expect(
      short.getByRole("button", { name: "Read aloud" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await engineLog()).match(/^stopped$/gm)?.length ?? 0)
      .toBeGreaterThanOrEqual(1);

    // A few idle seconds later the model is out of memory; the next reading loads it again.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.relay.readAloudState().then((s) => s.loaded ?? null),
          ),
        {
          timeout: 15000,
        },
      )
      .toBeNull();
    events = await heard();
    const ended = events.length;
    await short.hover();
    await short.getByRole("button", { name: "Read aloud" }).click();
    await expect
      .poll(async () =>
        (await heard()).slice(ended).some((e) => e.type === "audio"),
      )
      .toBe(true);
    expect(await loads()).toBe(2);
    await short.getByRole("button", { name: "Stop reading" }).click();

    // A crashing engine ends the reading with a reason, and the next one starts afresh.
    const crash = await ask("Please crash now, thanks.");
    await crash.hover();
    await crash.getByRole("button", { name: "Read aloud" }).click();
    await expect(crash.getByRole("status")).toContainText(
      "Read aloud stopped unexpectedly.",
    );
    await screenshot(crash, {
      path: "test-results/screenshots/read-aloud-crashed.png",
    });
    const afterCrash = (await heard()).length;
    await short.hover();
    await short.getByRole("button", { name: "Read aloud" }).click();
    await expect(short.getByRole("button", { name: "Read aloud" })).toBeVisible(
      {
        timeout: 15000,
      },
    );
    expect(
      (await heard()).slice(afterCrash).some((e) => e.type === "audio"),
    ).toBe(true);
    expect(await loads()).toBe(3);

    // Deleting the engine takes the action's voice away until it's downloaded again.
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .first()
      .click();
    await settings
      .getByRole("button", { name: "Read aloud", exact: true })
      .click();
    await engine.getByRole("button", { name: "Delete" }).click();
    await expect(
      engine.getByRole("button", { name: "Download" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to app" }).click();
    await short.hover();
    await short.getByRole("button", { name: "Read aloud" }).click();
    await expect(short.getByRole("status")).toContainText(
      "Download a voice in Settings → Read aloud first.",
    );
  } finally {
    await app.close();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
