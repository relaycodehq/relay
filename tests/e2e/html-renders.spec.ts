import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
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

test("an agent shows pages in its answer: fitted, themed, variants to switch between, back after a reload", async () => {
  test.setTimeout(120_000);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-html-renders-")),
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
    app = await electron.launch({
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

    // A look the user doesn't see: a picture at the width asked for, and what it logged.
    const looked = await callTool(page, "preview_html", {
      html: `<div style="height:300px"></div><script>console.error("chart failed")</script>`,
      width: 640,
    });
    expect(looked).toMatch(/^\[image\/png (\d+)x(\d+)\]/);
    const [, w, h] = /^\[image\/png (\d+)x(\d+)\]/.exec(looked)!;
    expect(Number(w) / Number(h)).toBeCloseTo(640 / 300, 2);
    expect(looked).toContain("At 640 px wide the page is 300 px tall");
    expect(looked).toContain("chart failed");
    await expect(page.locator(".html-render")).toHaveCount(0);

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
