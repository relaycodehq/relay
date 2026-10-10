import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSurface } from "../fixtures/navigation";

// Downloads the real expo-device-hub with the user's npm and streams a real
// emulator, so it runs only when asked: boot one, then RELAY_DEVICE_E2E=1.
test("the Device surface downloads the hub, streams a booted emulator over the panel, sleeps the hub while nobody watches, and stops it on quit", async () => {
  test.skip(
    !process.env.RELAY_DEVICE_E2E,
    "Boot an Android Emulator, then set RELAY_DEVICE_E2E=1",
  );
  test.setTimeout(300_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-device-"))),
    repo = join(root, "project");
  await mkdir(repo, { recursive: true });
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "Device fixture\n");
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
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: process.env.RELAY_TEST_HEADED ?? "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  /** The hub's page, when it's laid over Relay's window. */
  const hubView = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (w) =>
          w.webContents.getURL().includes("index.html") ||
          w.webContents.getURL().startsWith("http://127.0.0.1:5177"),
      )!;
      const view = win.contentView.children.find(
        (v) =>
          "webContents" in v &&
          v.webContents !== win.webContents &&
          /^http:\/\/127\.0\.0\.1:(?!5177)/.test(
            (v as Electron.WebContentsView).webContents.getURL(),
          ),
      ) as Electron.WebContentsView | undefined;
      return view
        ? { url: view.webContents.getURL(), bounds: view.getBounds() }
        : null;
    });
  let hubOrigin = "";
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Add a project", exact: true })
      .getByRole("option", { name: "Choose in Finder…", exact: true })
      .click();

    await openSurface(page, "Device");
    const panel = page.locator('[data-pane="panel"]');
    await expect(panel.getByRole("tab", { name: "Device" })).toBeVisible();
    // Nothing downloads until asked.
    expect(await hubView()).toBeNull();
    await panel
      .getByRole("button", { name: "Download and start", exact: true })
      .click();
    await expect.poll(hubView, { timeout: 180_000 }).not.toBeNull();
    const shown = (await hubView())!;
    hubOrigin = new URL(shown.url).origin;
    expect(hubOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // The token became a cookie and left the address.
    expect(shown.url).not.toContain("token=");
    const box = (await panel.locator(".device-surface").boundingBox())!;
    expect(shown.bounds.width).toBeGreaterThan(0);
    expect(Math.abs(shown.bounds.x - box.x)).toBeLessThanOrEqual(1);

    const hubPage = () =>
      app.evaluate(async ({ webContents }, origin) => {
        const wc = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith(origin))!;
        return wc.executeJavaScript("document.body.innerText");
      }, hubOrigin);
    await expect.poll(hubPage, { timeout: 60_000 }).toContain("Live");
    // Without the cookie the hub refuses.
    expect((await fetch(`${hubOrigin}/api/devices`)).status).toBe(401);

    await page.screenshot({ path: "test-results/device-panel.png" });
    const frame = await app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith(origin))!;
      return (await wc.capturePage()).toPNG().toString("base64");
    }, hubOrigin);
    await writeFile("test-results/device-view.png", Buffer.from(frame, "base64"));

    const up = (origin: string) => () =>
      fetch(`${origin}/readyz`).then(() => "up", () => "down");
    // Another tab in front: the page unloads after 20 s and the hub stops.
    await openSurface(page, "Files");
    await expect.poll(hubView).toBeNull();
    expect(await up(hubOrigin)()).toBe("up");
    await expect.poll(up(hubOrigin), { timeout: 40_000 }).toBe("down");
    // Back in front, the last frame shows while a new hub starts.
    await openSurface(page, "Device");
    await expect(panel.locator(".device-snapshot")).toBeVisible();
    await expect.poll(hubView, { timeout: 30_000 }).not.toBeNull();
    const woken = new URL((await hubView())!.url).origin;
    expect(woken).not.toBe(hubOrigin);
    hubOrigin = woken;
    await expect.poll(hubPage, { timeout: 60_000 }).toContain("Live");

    // Closing the tab takes the page away and stops the hub.
    await panel.getByRole("tab", { name: "Device" }).hover();
    await panel.getByRole("button", { name: "Close device" }).click();
    await expect.poll(hubView).toBeNull();
    await expect.poll(up(hubOrigin)).toBe("down");
    hubOrigin = "";
  } finally {
    await app.close();
  }
  if (hubOrigin)
    await expect
      .poll(() => fetch(`${hubOrigin}/readyz`).then(() => "up", () => "down"))
      .toBe("down");
});

// One hub page for every window: closing the tab where it lies hands it to
// the window that still shows the tab, instead of stopping the hub under it.
test("closing the Device tab in one window keeps it live in another", async () => {
  test.skip(
    !process.env.RELAY_DEVICE_E2E,
    "Boot an Android Emulator, then set RELAY_DEVICE_E2E=1",
  );
  test.setTimeout(300_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-device-"))),
    repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo, { recursive: true });
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const thread = (title: string, at: number) => ({
    id: randomUUID(),
    projectId,
    title,
    scope: { kind: "project" },
    created: at - 60_000,
    updated: at,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        provider: "codex",
        status: "complete",
        body: `@codex ${title}`,
        created: at - 30_000,
        version: 1,
      },
      {
        id: randomUUID(),
        role: "assistant",
        provider: "codex",
        status: "complete",
        body: `Answer in ${title}`,
        created: at,
        ended: at,
        version: 1,
      },
    ],
  });
  const popped = thread("Popped", Date.now()),
    stays = thread("Stays", Date.now() - 60_000);
  for (const c of [popped, stays])
    await writeFile(join(data, "project-chats", c.id + ".json"), JSON.stringify(c));
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      projects: [{ id: projectId, path: repo, name: "project", repository: null, added: 1 }],
      chats: [popped, stays].map(({ messages, ...c }) => ({ ...c, provider: "codex" })),
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && k !== "RELAY_DEV_URL" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: process.env.RELAY_TEST_HEADED ?? "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  /** Which window the hub's page lies over: "main", "popped" or null. */
  const pageIn = () =>
    app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        const hub = win.contentView.children.some(
          (v) =>
            "webContents" in v &&
            /^http:\/\/127\.0\.0\.1:(?!5177)/.test(
              (v as Electron.WebContentsView).webContents.getURL(),
            ),
        );
        if (hub) return win.webContents.getURL().includes("thread=") ? "popped" : "main";
      }
      return null;
    });
  let hubOrigin = "";
  const hubUp = () =>
    fetch(`${hubOrigin}/readyz`).then(() => "up", () => "down");
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => localStorage.setItem("relay-sidebar-view", "activity"));
    await page.reload();
    const card = (title: string) =>
      page.locator(".sb-card").filter({
        has: page.locator(".sb-card-title", { hasText: title }),
      });
    await card("Popped").click();
    await expect(page.getByText("Answer in Popped")).toBeVisible();
    const opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "Open in new window" }).click();
    const own = await opened;
    await expect(own.getByText("Answer in Popped")).toBeVisible();
    await card("Stays").click();
    await expect(page.getByText("Answer in Stays")).toBeVisible();

    await openSurface(page, "Device");
    const mainPanel = page.locator('[data-pane="panel"]');
    await mainPanel.getByRole("button", { name: "Download and start", exact: true }).click();
    await expect.poll(pageIn, { timeout: 180_000 }).toBe("main");
    hubOrigin = await app.evaluate(({ webContents }) =>
      new URL(
        webContents
          .getAllWebContents()
          .find((w) => /^http:\/\/127\.0\.0\.1:(?!5177)/.test(w.getURL()))!
          .getURL(),
      ).origin,
    );
    // Shown in the popped window too, the page moves there.
    await openSurface(own, "Device");
    await expect.poll(pageIn, { timeout: 30_000 }).toBe("popped");

    // Closed where it lies, it goes back to the main window, still live.
    const ownPanel = own.locator('[data-pane="panel"]');
    await ownPanel.getByRole("tab", { name: "Device" }).hover();
    await ownPanel.getByRole("button", { name: "Close device" }).click();
    await expect.poll(pageIn, { timeout: 10_000 }).toBe("main");
    expect(await hubUp()).toBe("up");

    // Shown again in the popped window, then closed in the main one instead.
    await openSurface(own, "Device");
    await expect.poll(pageIn, { timeout: 30_000 }).toBe("popped");
    await mainPanel.getByRole("tab", { name: "Device" }).hover();
    await mainPanel.getByRole("button", { name: "Close device" }).click();
    await page.waitForTimeout(1_500);
    expect(await pageIn()).toBe("popped");
    expect(await hubUp()).toBe("up");

    // The last one closed: the page goes and the hub stops.
    await ownPanel.getByRole("tab", { name: "Device" }).hover();
    await ownPanel.getByRole("button", { name: "Close device" }).click();
    await expect.poll(pageIn).toBeNull();
    await expect.poll(hubUp).toBe("down");
  } finally {
    await app.close();
  }
});
