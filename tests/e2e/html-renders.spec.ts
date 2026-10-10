import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

/** Has the thread's agent call one of Relay's tools, and resolves to its answer. */
async function callTool(page: Page, tool: string, input: unknown) {
  const answers = page.getByRole("article", { name: "codex answer" });
  const before = await answers.count();
  await page
    .getByLabel("Message project")
    .fill(`fixture relay ${tool} ${JSON.stringify(input)}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Stop answer", exact: true }),
  ).toHaveCount(0, { timeout: 30_000 });
  return (await answers.last().locator(".markdown").innerText()).trim();
}

const card = (name: string, height: number) =>
  `<!doctype html><html><head><style>.c{position:relative;box-sizing:border-box;height:${height}px;color:var(--text);border:1px solid var(--border)}button{position:absolute;right:8px;bottom:8px}</style></head><body><div class="c">${name} card<button onclick="relay.compose('Make ${name} wider')">Ask</button></div></body></html>`;

/** Relay on a fresh project whose agent answers from the room fixture. */
async function openProject(root: string) {
  const bin = join(root, "bin"),
    repo = join(root, "project");
  await mkdir(bin);
  const script = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"])
    await fakeCli(join(bin, name), script);
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "fixture\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        k !== "ELECTRON_RUN_AS_NODE" &&
        k !== "RELAY_DEV_URL" &&
        v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: process.env.RELAY_TEST_HEADED ?? "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, repo);
  await page.evaluate(() => window.relay.addProject());
  await page.reload();
  return { app, page };
}

test("an agent shows pages in its answer: fitted, themed, variants to switch between, back after a reload", async () => {
  test.setTimeout(120_000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-html-renders-")),
  );
  let app: ElectronApplication | undefined;
  try {
    const opened = await openProject(root);
    app = opened.app;
    const page = opened.page;

    // A look the user doesn't see: in the app's theme, a picture at the width
    // asked for, and what it logged.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const looked = await callTool(page, "preview_html", {
      html: `<div style="height:300px"></div><script>console.error("chart failed")</script>`,
      width: 640,
    });
    expect(looked).toMatch(/^\[image\/png (\d+)x(\d+)\]/);
    const [, w, h] = /^\[image\/png (\d+)x(\d+)\]/.exec(looked)!;
    expect(Number(w) / Number(h)).toBeCloseTo(640 / 300, 2);
    expect(looked).toMatch(
      /In the app's dark theme, at 640 px wide the page is 300 px tall/,
    );
    expect(looked).toContain("chart failed");
    await expect(page.locator(".html-render")).toHaveCount(0);
    await page.emulateMedia({ colorScheme: "light" });

    // Shown: the answer carries it above its reply, at the height it measured.
    const shown = await callTool(page, "show_html", {
      title: "Card density",
      variants: [
        { label: "Compact", html: card("Compact", 180) },
        { label: "Roomy", html: card("Roomy", 260) },
      ],
    });
    expect(shown).toContain('Shown in your answer as "Card density"');
    const render = page.getByRole("region", { name: "Card density" });
    const frame = render.locator(".html-render-frame");
    await expect(frame).toHaveCSS("height", "180px");
    const compact = page.frameLocator('iframe[title="Card density: Compact"]');
    await expect(compact.getByText("Compact card")).toBeVisible();
    // The page reads the app's colours.
    const text = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--text")
        .trim(),
    );
    const color = await compact
      .locator(".c")
      .evaluate((el) => getComputedStyle(el).color);
    const probe = await page.evaluate((c) => {
      const el = document.createElement("i");
      el.style.color = c;
      document.body.append(el);
      const value = getComputedStyle(el).color;
      el.remove();
      return value;
    }, text);
    expect(color).toBe(probe);

    // Variants switch in place and refit.
    await render.getByRole("tab", { name: "Roomy" }).click();
    await expect(frame).toHaveCSS("height", "260px");
    const roomy = page.frameLocator('iframe[title="Card density: Roomy"]');
    await expect(roomy.getByText("Roomy card")).toBeVisible();
    await page.screenshot({ path: join(tmpdir(), "relay-html-render.png") });
    // What the page hands over goes to the composer.
    const composer = page.getByLabel("Message project");
    await roomy.getByRole("button", { name: "Ask" }).click();
    await expect(composer).toContainText("Make Roomy wider");

    // Saved with the thread: a reload shows it again.
    await page.reload();
    await expect(
      page
        .frameLocator('iframe[title="Card density: Compact"]')
        .getByText("Compact card"),
    ).toBeVisible();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

/** The system clipboard as raw entries per type, held by the test so a failed run can still put it back. */
type SavedClipboard = {
  type: string;
  base64?: string;
  bookmark?: { title: string; url: string };
}[][];

// "findtext" is macOS's separate Find pasteboard, which shows in every read
// and which copying an image leaves alone.
const saveClipboard = (app: ElectronApplication) =>
  app.evaluate(async ({ clipboard }) =>
    Promise.all(
      (await clipboard.read()).map(async (item) =>
        (
          await Promise.all(
            item.types
              .filter((type) => type !== "electron application/findtext")
              .map(async (type) => {
                try {
                  const data = await item.getType(type);
                  return data instanceof Blob
                    ? {
                        type,
                        base64: Buffer.from(await data.arrayBuffer()).toString(
                          "base64",
                        ),
                      }
                    : { type, bookmark: data };
                } catch {
                  return undefined;
                }
              }),
          )
        ).filter((entry) => !!entry),
      ),
    ),
  ) as Promise<SavedClipboard>;

const restoreClipboard = (app: ElectronApplication, saved: SavedClipboard) =>
  app.evaluate(async ({ clipboard, ClipboardItem }, saved) => {
    if (!saved.some((entries) => entries.length)) return clipboard.clear();
    await clipboard.write(
      saved.map(
        (entries) =>
          new ClipboardItem(
            Object.fromEntries(
              entries.map((entry) => [
                entry.type,
                entry.bookmark ??
                  new Blob([Buffer.from(entry.base64 ?? "", "base64")], {
                    type: entry.type,
                  }),
              ]),
            ),
          ),
      ),
    );
  }, saved);

/** What the clipboard's picture is: its size and the colour at its middle. */
const clipboardImage = (app: ElectronApplication) =>
  app.evaluate(async ({ clipboard, nativeImage }) => {
    const item = (await clipboard.read()).find((i) =>
      i.types.includes("image/png"),
    );
    if (!item) return null;
    const blob = (await item.getType("image/png")) as Blob;
    const image = nativeImage.createFromBuffer(
      Buffer.from(await blob.arrayBuffer()),
    );
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    // BGRA
    const rgb = (row: number, column = Math.floor(width / 2)) => {
      const at = (row * width + column) * 4;
      return [bitmap[at + 2], bitmap[at + 1], bitmap[at]];
    };
    return {
      width,
      height,
      rgb: rgb(Math.floor(height / 2)),
      // Where the composer floats over the thread, were it in the picture.
      bottom: rgb(height - 3),
      corners: [
        rgb(2, 2),
        rgb(2, width - 3),
        rgb(height - 3, 2),
        rgb(height - 3, width - 3),
      ],
    };
  });

test("a page expands in place and is copied or saved as the user left it", async () => {
  test.setTimeout(120_000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-html-render-export-")),
  );
  let app: ElectronApplication | undefined;
  /** What the user had copied, while the test borrows the clipboard. */
  let clipboardBefore: SavedClipboard | undefined;
  try {
    const opened = await openProject(root);
    app = opened.app;
    const page = opened.page;
    const saved = join(root, "saved");
    await mkdir(saved);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as { defaultPath?: string };
        const name = options.defaultPath?.split("/").pop() ?? "page";
        return { canceled: false, filePath: `${folder}/${name}` };
      }) as typeof dialog.showSaveDialog;
    }, saved);

    await callTool(page, "show_html", {
      title: "Toggle box",
      html: `<!doctype html><html><head><style>.p{position:relative;height:200px;background:#1e90ff}.p.on{background:#ff0000}input{position:absolute;left:8px;top:8px}</style></head><body><div class="p" onclick="this.classList.add('on')"><input aria-label="Note"></div></body></html>`,
    });
    const render = page.getByRole("region", { name: "Toggle box" });
    const inside = page.frameLocator('iframe[title="Toggle box"]');
    await inside.locator(".p").click();
    await expect(inside.locator(".p.on")).toHaveCount(1);

    // Expanded, it's the same page, larger: what was clicked stays clicked.
    await render.getByRole("button", { name: "Expand" }).click();
    const stage = page.getByRole("dialog", { name: "Toggle box" });
    await expect(stage).toBeVisible();
    await expect(inside.locator(".p.on")).toHaveCount(1);
    const zoom = async () =>
      Number(
        (await stage.locator(".html-render-zoom-level").innerText()).replace(
          "%",
          "",
        ),
      );
    const fitted = await zoom();
    expect(fitted).toBeGreaterThan(100);
    // Clicked into, the page has the keys, and hands up the stage's.
    await inside.locator(".p").click({ position: { x: 300, y: 150 } });
    await page.keyboard.press("+");
    await expect.poll(zoom).toBeGreaterThan(fitted);
    await page.keyboard.press("0");
    await expect.poll(zoom).toBe(fitted);
    // Typed into the page's own field, they stay text; Esc still closes.
    const note = inside.getByLabel("Note");
    await note.click();
    await page.keyboard.type("-0+");
    await expect(note).toHaveValue("-0+");
    expect(await zoom()).toBe(fitted);
    await page.keyboard.press("Escape");
    await expect(stage).toBeHidden();
    await expect(render.getByRole("button", { name: "Expand" })).toBeFocused();

    // Fits on screen: the picture is the frame as it stands, red, scrolled
    // out from under the composer first, and exactly the frame at any
    // interface scale, whose CSS pixels aren't the window's.
    clipboardBefore = await saveClipboard(app);
    // The page repaints at a new pixel ratio in its own process; until it
    // has, Chromium routes a press by the frame's old place, into the page.
    const inner = (await (
      await render.locator("iframe").elementHandle()
    )?.contentFrame())!;
    const setScale = async (scale: number) => {
      await page.evaluate((s) => window.relay.setInterfaceScale(s), scale);
      const ratio = await page.evaluate(() => devicePixelRatio);
      await expect
        .poll(() => inner.evaluate(() => devicePixelRatio))
        .toBe(ratio);
      await inner.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
      return ratio;
    };
    for (const scale of [1, 1.25]) {
      const ratio = await setScale(scale);
      await render
        .locator("iframe")
        .evaluate((e) => e.scrollIntoView({ block: "end" }));
      await app.evaluate(({ clipboard }) => clipboard.clear());
      await render.getByRole("button", { name: "Copy or save" }).click();
      await page.getByRole("menuitem", { name: "Copy image" }).click();
      await expect
        .poll(async () => (await clipboardImage(app!))?.rgb)
        .toEqual([255, 0, 0]);
      const live = (await clipboardImage(app))!;
      expect(live.bottom).toEqual([255, 0, 0]);
      expect(live.corners).toEqual(Array(4).fill([255, 0, 0]));
      const box = await render
        .locator("iframe")
        .evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
      expect(Math.abs(live.width - box.width * ratio)).toBeLessThanOrEqual(2);
      expect(Math.abs(live.height - box.height * ratio)).toBeLessThanOrEqual(2);
    }
    await setScale(1);
    await restoreClipboard(app, clipboardBefore);
    clipboardBefore = undefined;

    await render.getByRole("button", { name: "Copy or save" }).click();
    await page.getByRole("menuitem", { name: "Save as HTML…" }).click();
    await expect
      .poll(() =>
        readFile(join(saved, "toggle-box.html"), "utf8").catch(() => ""),
      )
      .toContain("root.dataset.theme");
    const html = await readFile(join(saved, "toggle-box.html"), "utf8");
    expect(html).toContain(".p.on{background:#ff0000}");
    expect(html).toContain('"--text"');

    // Taller than the thread can show: loaded afresh, whole, unclicked.
    await callTool(page, "show_html", {
      title: "Tall page",
      html: `<!doctype html><html><head><style>.t{height:3000px;background:#1e90ff}</style></head><body><div class="t"></div></body></html>`,
    });
    const tall = page.getByRole("region", { name: "Tall page" });
    // Scrolled first, so click() waits out painted frames: its own scroll
    // presses in the same frame, and Chromium routes the press by the last
    // painted frame, where the page's out-of-process frame still covered the
    // button, so the page gets it instead.
    await tall.locator(".html-render-head").scrollIntoViewIfNeeded();
    await tall.getByRole("button", { name: "Copy or save" }).click();
    await page.getByRole("menuitem", { name: "Save as PNG…" }).click();
    await expect
      .poll(() =>
        readFile(join(saved, "tall-page.png")).then(
          (b) => b.length,
          () => 0,
        ),
      )
      .toBeGreaterThan(0);
    const size = await app.evaluate(
      ({ nativeImage }, file) => {
        const image = nativeImage.createFromPath(file);
        return image.getSize();
      },
      join(saved, "tall-page.png"),
    );
    const frameWidth = (await tall.locator("iframe").boundingBox())!.width;
    expect(size.height / size.width).toBeCloseTo(3000 / frameWidth, 1);
  } finally {
    if (app && clipboardBefore)
      await restoreClipboard(app, clipboardBefore).catch((e) =>
        console.warn("Couldn't put the clipboard back:", e),
      );
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
