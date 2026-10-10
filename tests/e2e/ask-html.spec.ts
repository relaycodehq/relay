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
import { screenshot } from "../fixtures/screenshot";

// An agent asks with a page of its own (ask_html): the page stays in its
// answer, and what the user sends from it, or a skip, is their next message.

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
      RELAY_AGENT_CAPTURE: join(root, "agent.jsonl"),
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
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

/** Has the thread's agent ask with a page; the turn stays open on it. */
async function ask(page: Page, input: unknown) {
  await page
    .getByLabel("Message project")
    .fill(`fixture relay ask_html ${JSON.stringify(input)}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

const picker = `<!doctype html><html><body>
<p>Which sound?</p>
<button onclick="relay.answer({ sound: 'glass', volume: 0.7 })">Glass</button>
<button onclick="relay.answer({ sound: 'marimba', volume: 0.7 })">Marimba</button>
</body></html>`;

test("an agent asks with a page and gets back what the user picked, or that they skipped", async () => {
  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-ask-")));
  let app: ElectronApplication | undefined;
  try {
    const opened = await openProject(root);
    app = opened.app;
    const page = opened.page;
    const answers = page.getByRole("article", { name: "codex answer" });
    /** What the agent has been told, as the fixture logged it. */
    const told = () =>
      readFile(join(root, "agent.jsonl"), "utf8").catch(() => "");

    const stop = page.getByRole("button", { name: "Stop answer", exact: true });
    const mine = page.getByRole("article", { name: "Your message" });

    await ask(page, {
      title: "Pick a sound",
      html: picker,
      detail: "Click one; the last click counts.",
    });
    // The tool returns at once and the turn ends: nothing waits on a tool
    // call that a client would time out. The page stays in the answer.
    await expect(answers).toHaveCount(1, { timeout: 30_000 });
    await expect(answers.last()).toContainText(
      'Shown to the user as "Pick a sound"',
    );
    await expect(stop).toHaveCount(0, { timeout: 30_000 });
    const card = page.getByRole("region", { name: "Pick a sound" });
    await expect(card).toBeVisible();
    // What the agent says about it reads as words, not as a command.
    await expect(card.locator(".agent-request-note")).toHaveText(
      "Click one; the last click counts.",
    );
    const send = card.getByRole("button", { name: "Send answer" });
    // Nothing to send until the page hands something over.
    await expect(send).toBeDisabled();
    const frame = card.frameLocator("iframe");
    await frame.getByRole("button", { name: "Marimba" }).click();
    await frame.getByRole("button", { name: "Glass" }).click();
    await expect(send).toBeEnabled();
    await screenshot(page, { path: "test-results/screenshots/ask-html.png" });
    await send.click();
    // The last thing the page handed over goes to the agent as the next
    // message, which shows as a quiet line rather than words in the user's mouth.
    await expect(page.getByText("You answered “Pick a sound”")).toBeVisible();
    await expect(mine).toHaveCount(1);
    await expect(answers).toHaveCount(2, { timeout: 30_000 });
    await expect
      .poll(told)
      .toContain(
        String.raw`Answer to your page \"Pick a sound\":\n{\"sound\":\"glass\",\"volume\":0.7}`,
      );
    await expect(card).toHaveCount(0);
    await expect(page.getByText('Answered "Pick a sound"')).toBeVisible();

    // Skipping leaves the choice to the agent.
    await expect(stop).toHaveCount(0, { timeout: 30_000 });
    await ask(page, { title: "Pick again", html: picker });
    const again = page.getByRole("region", { name: "Pick again" });
    await again.getByRole("button", { name: "Skip" }).click();
    await expect(
      page.getByText("You skipped “Pick again” and left it to the agent"),
    ).toBeVisible();
    await expect
      .poll(told)
      .toContain(
        String.raw`I skipped your page \"Pick again\". Decide on your own`,
      );
    await expect(page.getByText('Skipped "Pick again"')).toBeVisible();
    await screenshot(page, {
      path: "test-results/screenshots/ask-html-answered.png",
    });
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
