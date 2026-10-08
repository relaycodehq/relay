import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openSurface } from "../fixtures/navigation";

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test("the Browser surface starts the project's dev server and shows its page over the panel", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-preview-"))),
    repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(
    join(repo, "server.js"),
    `require("http").createServer((req, res) => {
  if (req.url === "/favicon.svg") {
    res.setHeader("content-type", "image/svg+xml");
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="royalblue"/></svg>');
  }
  res.setHeader("content-type", "text/html");
  res.end("<title>Preview fixture</title>" + (req.url === "/again" ? "" : "<link rel=icon href=/favicon.svg>") + "<h1>Port " + process.env.PORT + "</h1>");
}).listen(+process.env.PORT, "127.0.0.1");
`,
  );
  git("add", ".");
  git("commit", "-qm", "Base");
  const port = await freePort();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: process.env.RELAY_TEST_HEADED ?? "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_TEST_PREVIEW_UNLOAD_MS: "4000",
    },
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    app.process().once("exit", (code, signal) => resolve({ code, signal }));
  });
  /** The pages laid over Relay's own, with where they sit. */
  const overlays = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (w) =>
          w.webContents.getURL().includes("index.html") ||
          w.webContents.getURL().startsWith("http://127.0.0.1:5177"),
      )!;
      return win.contentView.children
        .filter((v) => "webContents" in v && v.webContents !== win.webContents)
        .map((v) => ({
          title: (v as Electron.WebContentsView).webContents.getTitle(),
          bounds: v.getBounds(),
        }));
    });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Add a project", exact: true })
      .getByRole("option", { name: "Choose in Finder…", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.relay.projects()).length),
      )
      .toBe(1);
    await page.evaluate(async (port) => {
      const [project] = await window.relay.projects();
      await window.relay.saveProjectSettings(project!.id, {
        devCommand: "node server.js",
        devPort: port,
      });
    }, port);

    await openSurface(page, "Browser");
    const panel = page.locator('[data-pane="panel"]');
    await expect(
      panel.getByRole("tab", { name: "Preview fixture" }),
    ).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
      `http://localhost:${port}/`,
      { timeout: 30_000 },
    );
    await expect
      .poll(overlays, { timeout: 15_000 })
      .toEqual([expect.objectContaining({ title: "Preview fixture" })]);
    await expect(panel.locator(".browser-tab-icon")).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml;base64,/,
    );
    await expect
      .poll(() =>
        panel
          .locator(".browser-tab-icon")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({ path: "test-results/browser-tab.png" });
    // Title changes from the page update the tab too.
    await app.evaluate(
      ({ webContents }, port) =>
        webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().includes(`:${port}/`))!
          .executeJavaScript('document.title = "Updated page title"'),
      port,
    );
    await expect(
      panel.getByRole("tab", { name: "Updated page title" }),
    ).toBeVisible();
    await app.evaluate(
      ({ webContents }, port) =>
        webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().includes(`:${port}/`))!
          .executeJavaScript('document.title = "Preview fixture"'),
      port,
    );
    await expect(
      panel.getByRole("tab", { name: "Preview fixture" }),
    ).toBeVisible();
    // It sits over the viewport, below the address bar, at the window's zoom.
    const viewport = await panel.locator(".browser-viewport").boundingBox();
    const zoom = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
    );
    const [{ bounds }] = await overlays();
    expect(bounds.x).toBeCloseTo(viewport!.x * zoom, -1);
    expect(bounds.y).toBeCloseTo(viewport!.y * zoom, -1);
    expect(bounds.width).toBeCloseTo(viewport!.width * zoom, -1);

    // Anything opening over it takes it off, since it would draw on top.
    await page.evaluate(() => {
      const cover = document.createElement("div");
      cover.id = "cover";
      cover.setAttribute("role", "dialog");
      cover.style.cssText = "position:fixed;inset:0;";
      document.body.append(cover);
    });
    await expect.poll(overlays).toEqual([]);
    // Its last frame stands in, so the panel doesn't go blank under a menu.
    await expect(panel.locator(".browser-snapshot")).toBeAttached();
    await page.evaluate(() => document.getElementById("cover")!.remove());
    await expect.poll(overlays).toHaveLength(1);
    await expect(panel.locator(".browser-snapshot")).toHaveCount(0);

    // Behind another tab it hides; the page stays loaded.
    await openSurface(page, "Files");
    await expect.poll(overlays).toEqual([]);
    await panel.getByRole("tab", { name: "Preview fixture" }).click();
    await expect
      .poll(overlays)
      .toEqual([expect.objectContaining({ title: "Preview fixture" })]);

    // Popped out, it lives in a window of its own until brought back.
    const windows = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await panel.getByRole("button", { name: "Open in its own window" }).click();
    await expect.poll(windows).toBe(2);
    await expect.poll(overlays).toEqual([]);
    await expect(panel.getByText("Showing in its own window.")).toBeVisible();
    await panel.getByRole("button", { name: "Bring it back" }).click();
    await expect.poll(windows).toBe(1);
    await expect.poll(overlays).toHaveLength(1);

    // Typed addresses load in it.
    const address = panel.getByRole("textbox", { name: "Address" });
    await address.fill(`127.0.0.1:${port}/again`);
    await address.press("Enter");
    await expect(address).toHaveValue(`http://127.0.0.1:${port}/again`);
    // A page without an icon must not inherit the previous page's favicon.
    await expect(panel.locator(".browser-tab-icon")).toHaveCount(0);
    await expect(
      panel.getByRole("tab", { name: "Preview fixture" }).locator("svg"),
    ).toBeVisible();

    // Out of sight a while, the page is unloaded; back in front it returns
    // where it was, history included.
    const pages = () =>
      app.evaluate(
        ({ webContents }, port) =>
          webContents
            .getAllWebContents()
            .filter((wc) => wc.getURL().includes(`:${port}/`)).length,
        port,
      );
    await openSurface(page, "Files");
    await expect.poll(pages, { timeout: 15_000 }).toBe(0);
    await panel.getByRole("tab", { name: "Preview fixture" }).click();
    await expect
      .poll(overlays)
      .toEqual([expect.objectContaining({ title: "Preview fixture" })]);
    await expect(address).toHaveValue(`http://127.0.0.1:${port}/again`);
    await expect(panel.getByRole("button", { name: "Back" })).toBeEnabled();

    // Closing the tab ends the page.
    await panel.getByRole("button", { name: "Close browser" }).click();
    await expect.poll(overlays).toEqual([]);
  } finally {
    // Keep the inspector connected until Relay's asynchronous quit preparation
    // finishes; Playwright's close disconnects it immediately after app.quit().
    await app
      .evaluate(
        ({ app }) =>
          new Promise<void>((resolve) => {
            app.once("will-quit", () => resolve());
            app.quit();
          }),
      )
      .catch(() => {});
    await app.close();
    expect(await exited).toEqual({ code: 0, signal: null });
    // A successful quit also closes the dev server Relay started for this fixture.
    await expect
      .poll(
        () =>
          new Promise<boolean>((resolve) => {
            const socket = connect({ host: "127.0.0.1", port });
            const done = (open: boolean) => {
              socket.destroy();
              resolve(open);
            };
            socket.once("connect", () => done(true));
            socket.once("error", () => done(false));
            socket.setTimeout(500, () => done(false));
          }),
      )
      .toBe(false);
  }
});
