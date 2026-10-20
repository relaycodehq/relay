import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, connect } from "node:net";
import { execFileSync } from "node:child_process";
import { openSurface } from "../fixtures/navigation";

async function listening(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

async function quit(app: ElectronApplication) {
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
}

test("restores the exact preview after quitting, restarts its server, and recovers from startup failure", async () => {
  test.setTimeout(120_000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-preview-recovery-")),
  );
  const repo = join(root, "project");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(
    join(repo, "server.cjs"),
    `
const fs = require('node:fs');
fs.appendFileSync('launches', 'started\\n');
if (fs.existsSync('fail')) { console.error('Fixture startup failed'); process.exit(1); }
require('node:http').createServer((req,res) => {
  res.setHeader('content-type','text/html');
  res.end('<title>Recovered preview</title><style>body{background:#202028;color:#eee;font:18px system-ui;padding:40px}small{color:#aaa}</style><small>Sample preview</small><h1>Right back where you left it.</h1><p>'+req.url+'</p>');
}).listen(+process.env.PORT,'127.0.0.1');
`,
  );
  git("add", ".");
  git("commit", "-qm", "Base");
  const port = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
  const initial = `http://localhost:${port}/previews/example/?view=one#first`;
  const restored = `http://localhost:${port}/previews/example/?view=two#details`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        key !== "ELECTRON_RUN_AS_NODE" &&
        key !== "RELAY_DEV_URL" &&
        value !== undefined,
    ),
  ) as Record<string, string>;
  const launch = () =>
    electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
  const launches = async () =>
    (await readFile(join(repo, "launches"), "utf8")).trim().split("\n").length;
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    const project = await page.evaluate(() => window.relay.addProject());
    expect(project).toBeTruthy();
    await page.reload();
    await openSurface(page, "Browser");
    let panel = page.locator('[data-pane="panel"]');
    await panel.getByRole("textbox", { name: "Address" }).fill(initial);
    await panel.getByRole("textbox", { name: "Address" }).press("Enter");
    await expect(
      panel.getByText("The preview server isn’t running."),
    ).toBeVisible();
    await expect(
      panel.getByLabel("Dev command", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(root, "preview-setup.png") });
    await panel
      .getByLabel("Dev command", { exact: true })
      .fill("node server.cjs");
    await panel
      .getByRole("button", { name: "Start preview", exact: true })
      .click();
    await expect(
      panel.getByRole("tab", { name: "Recovered preview", exact: true }),
    ).toBeVisible();
    expect(await launches()).toBe(1);
    // In-page navigation must update the saved address too, including query and fragment.
    await app.evaluate(
      async ({ webContents }, { port, restored }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().includes(`:${port}/`))!;
        await wc.executeJavaScript(
          `history.pushState({}, '', ${JSON.stringify(restored)})`,
        );
      },
      { port, restored },
    );
    await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
      restored,
    );
    await quit(app);
    app = undefined;
    await expect.poll(() => listening(port)).toBe(false);

    app = await launch();
    page = await app.firstWindow();
    await openSurface(page, "Browser");
    panel = page.locator('[data-pane="panel"]');
    await expect(
      panel.getByRole("tab", { name: "Recovered preview", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
      restored,
    );
    expect(await launches()).toBe(2);
    const frame = await app.evaluate(async ({ webContents }, restored) => {
      const wc = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === restored)!;
      const html = await wc.executeJavaScript("document.body.innerText");
      return { html, png: (await wc.capturePage()).toPNG().toString("base64") };
    }, restored);
    expect(frame.html).toContain("/previews/example/?view=two");
    await writeFile(
      join(root, "preview-restored.png"),
      Buffer.from(frame.png, "base64"),
    );
    await page.screenshot({ path: join(root, "preview-restored-shell.png") });
    await quit(app);
    app = undefined;
    await expect.poll(() => listening(port)).toBe(false);

    await writeFile(join(repo, "fail"), "");
    app = await launch();
    page = await app.firstWindow();
    await openSurface(page, "Browser");
    panel = page.locator('[data-pane="panel"]');
    await expect(panel.getByRole("alert")).toContainText(
      "Fixture startup failed",
    );
    await page.screenshot({ path: join(root, "preview-failed.png") });
    await rm(join(repo, "fail"));
    await panel.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      panel.getByRole("tab", { name: "Recovered preview", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
      restored,
    );
    expect(await launches()).toBe(4);
    console.log(`Preview recovery screenshots: ${root}`);
  } finally {
    if (app) await quit(app);
    await expect.poll(() => listening(port)).toBe(false);
  }
});
