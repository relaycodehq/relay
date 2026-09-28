import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("asks /btw beside a running turn in a side thread of its own", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-btw-")));
  const repo = join(root, "project"),
    bin = join(root, "bin");
  const fixture = await fixtureServer();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(repo);
    await mkdir(bin);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    execFileSync("git", [
      "-C",
      repo,
      "remote",
      "add",
      "origin",
      fixture.serverUrl + "/Web/web-store.git",
    ]);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_AGENT_CAPTURE: join(root, "agent.jsonl"),
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    const prompt = page.getByLabel("Message project");
    await prompt.fill("wait for cancellation");
    await prompt.press("Enter");
    const stop = page.getByRole("button", { name: "Stop answer", exact: true });
    await expect(stop).toBeVisible();
    await expect(
      page.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();

    // Asked mid-turn: it doesn't queue, and its thread opens with the answer.
    await prompt.fill("/btw which test covers the guard?");
    await prompt.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Side question" }),
    ).toBeVisible();
    const thread = page.locator(".thread-message-column");
    await expect(
      thread.locator(".project-message.assistant .markdown"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("region", { name: "Queued messages" }),
    ).toHaveCount(0);
    await page.screenshot({ path: "test-results/side-question-thread.png" });

    // Back in the thread: the question, dashed, with its reply count; the turn still runs.
    await page.getByRole("button", { name: "Back to conversation" }).click();
    const question = page.getByRole("article", { name: "Your side question" });
    await expect(question).toContainText("which test covers the guard?");
    await expect(question.locator(".side-thread-bar")).toContainText("1 reply");
    await expect(stop).toBeVisible();
    await page.screenshot({ path: "test-results/side-question-main.png" });

    // A follow-up goes to the same side thread.
    await question.locator(".side-thread-bar").click();
    await prompt.fill("and the invalidation?");
    await prompt.press("Enter");
    await expect(
      thread.locator(".project-message.assistant .markdown"),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Back to conversation" }).click();
    await expect(question.locator(".side-thread-bar")).toContainText(
      "3 replies",
    );
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
