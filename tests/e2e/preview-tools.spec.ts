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
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openSurface } from "../fixtures/navigation";

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

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
  const markdown = answers.last().locator(".markdown");
  const code = markdown.locator("pre code");
  return (await ((await code.count()) ? code : markdown).innerText()).trim();
}

test("an agent opens its thread's preview, pictures it unseen and reads its errors; a picked element goes to the composer", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-preview-tools-")),
    ),
    bin = join(root, "bin"),
    repo = join(root, "project");
  let app: ElectronApplication | undefined;
  try {
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
    await writeFile(
      join(repo, "server.js"),
      `require("http").createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  const broken = req.url === "/broken";
  res.end(\`<title>Tools fixture</title>
<style>body{margin:0}#save{position:absolute;left:20px;top:20px;width:120px;height:40px}</style>
<button id="save" class="primary" type="button">Save changes</button>
\${broken ? "<script>console.error('Cannot read properties of undefined')</script>" : ""}\`);
}).listen(+process.env.PORT, "127.0.0.1");
`,
    );
    git("add", ".");
    git("commit", "-qm", "Base");
    const port = await freePort();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) =>
          k !== "ELECTRON_RUN_AS_NODE" &&
          k !== "RELAY_DEV_URL" &&
          v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: process.env.RELAY_TEST_HEADED ?? "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_TEST_PREVIEW_UNLOAD_MS: "4000",
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
    await page.evaluate(async (port) => {
      const [project] = await window.relay.projects();
      await window.relay.saveProjectSettings(project!.id, {
        devCommand: "node server.js",
        devPort: port,
      });
    }, port);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Full access");

    // Nothing to picture before the preview has a page.
    expect(await callTool(page, "screenshot", {})).toMatch(
      /Call open_preview first/,
    );

    // Opening starts the dev server and waits for the page.
    const opened = JSON.parse(await callTool(page, "open_preview", {}));
    expect(opened).toEqual({
      url: `http://localhost:${port}/`,
      browserUrl: expect.stringMatching(
        /^http:\/\/checkout-[a-f0-9]{8}\.project\.relay\.localhost:\d+\/$/,
      ),
      title: "Tools fixture",
      server: `running on port ${port}, started by Relay`,
      consoleErrorsWhileLoading: 0,
    });
    // The tool returns an already usable named route without opening the user's browser.
    const external = await browser.newPage();
    await external.goto(opened.browserUrl);
    await expect(external).toHaveTitle("[project] Tools fixture");
    expect(await external.evaluate(() => window.isSecureContext)).toBe(true);
    await external.close();

    // The panel is closed, so the page has never been drawn; it is pictured anyway.
    // 1280×800 at the screen's density, no wider than 1600.
    const shot = await callTool(page, "screenshot", {});
    const [, width, height, caption] =
      /^\[image\/png (\d+)x(\d+)\]\s+(.*)$/.exec(shot) ?? [];
    expect(caption).toBe(`http://localhost:${port}/ (Tools fixture)`);
    expect(Number(width) / Number(height)).toBe(1.6);
    expect(Number(width)).toBeGreaterThanOrEqual(1280);
    expect(Number(width)).toBeLessThanOrEqual(1600);

    // The first screenshot must also work after the unseen renderer unloads.
    await expect
      .poll(
        () =>
          app!.evaluate(
            ({ webContents }, port) =>
              webContents
                .getAllWebContents()
                .filter((wc) => wc.getURL().includes(`:${port}/`)).length,
            port,
          ),
        { timeout: 15_000 },
      )
      .toBe(0);
    expect(await callTool(page, "screenshot", {})).toMatch(
      /^\[image\/png \d+x\d+\]/,
    );

    // A path loads on the page's origin; what it logs is counted, then read.
    const broken = JSON.parse(
      await callTool(page, "open_preview", { url: "/broken" }),
    );
    expect(broken).toMatchObject({
      url: `http://localhost:${port}/broken`,
      browserUrl: opened.browserUrl + "broken",
      consoleErrorsWhileLoading: 1,
    });
    expect(await callTool(page, "console_errors", { clear: true })).toMatch(
      /^\[error\] \d+s ago( at .*)?\sCannot read properties of undefined$/,
    );
    expect(await callTool(page, "console_errors", {})).toBe(
      "Nothing logged: no errors or warnings.",
    );

    // The thread got a Browser tab for the page the agent opened.
    await openSurface(page, "Browser");
    const panel = page.locator('[data-pane="panel"]');
    await expect(
      panel.getByRole("button", { name: "Close browser", exact: true }),
    ).toHaveCount(1);
    await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
      `http://localhost:${port}/broken`,
    );

    // Picking: a click on the page hands the element to the composer.
    const pick = panel.getByRole("button", {
      name: "Pick an element to ask about",
    });
    await expect(pick).toBeEnabled();
    await pick.click();
    await expect(
      panel.getByRole("button", { name: "Stop picking (Esc)" }),
    ).toBeVisible();
    await app.evaluate(async ({ webContents }, port) => {
      const wc = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL().includes(`:${port}/`))!;
      const at = { x: 60, y: 40 };
      wc.sendInputEvent({ type: "mouseMove", ...at });
      await new Promise((r) => setTimeout(r, 100));
      wc.sendInputEvent({
        type: "mouseDown",
        ...at,
        button: "left",
        clickCount: 1,
      });
      wc.sendInputEvent({
        type: "mouseUp",
        ...at,
        button: "left",
        clickCount: 1,
      });
    }, port);
    const composer = page.getByLabel("Message project");
    await expect(composer).toContainText(
      `This element in the preview at http://localhost:${port}/broken:`,
    );
    await expect(composer).toContainText(
      '<button id="save" class="primary" type="button">',
    );
    await expect(composer).toContainText("Selector: `#save`");
    await expect(composer).toContainText('Its text: "Save changes"');
    await expect(composer.locator(".composer-image-chip")).toHaveCount(1);
    await expect(
      panel.getByRole("button", { name: "Pick an element to ask about" }),
    ).toBeVisible();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
