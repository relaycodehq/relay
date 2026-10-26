import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "../fixtures/electron";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("asks another agent for a second opinion and sends it back", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-opinion-")));
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    capture = join(root, "agent.jsonl");
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
    const env = relayEnv();
    app = await electron.launch({
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_AGENT_CAPTURE: capture,
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
    await prompt.fill("How does the cache avoid duplicate requests?");
    await prompt.press("Enter");
    const answer = page.locator(".project-message.assistant").first();
    await expect(answer).toContainText(
      "The cache guard prevents duplicate requests.",
    );

    // The answer's actions offer it; the picker asks which agent and model.
    await answer.hover();
    await answer
      .getByRole("button", { name: "Ask another agent for a second opinion" })
      .click();
    await page.getByRole("option", { name: "Codex default" }).click();

    // The opinion comes back under the answer, unseen by the agent that wrote it.
    const card = answer.locator(".second-opinions .thread-frame");
    await expect(card).toContainText("finished");
    await expect(card).toContainText(
      "The cache guard prevents duplicate requests.",
    );
    await expect(card).toContainText("Codex hasn't seen this.");
    await screenshot(page, { path: "test-results/second-opinion-card.png" });

    // Its agent was told a colleague answered, nothing of the thread or agent
    // behind it, and worked read-only.
    const turns = (await readFile(capture, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.turn);
    const opinionTurn = turns.find((entry) =>
      JSON.stringify(entry.turn.input).includes("My colleague answered"),
    );
    expect(JSON.stringify(opinionTurn?.turn.input)).toContain(
      "How does the cache avoid duplicate requests?",
    );
    expect(JSON.stringify(opinionTurn?.turn.input)).not.toMatch(
      /started this one|your lead|Codex/,
    );
    expect(opinionTurn?.turn.sandboxPolicy).toEqual({ type: "readOnly" });

    // Sent back, it reaches the thread as the second opinion's report.
    await card.getByRole("button", { name: "Send to Codex" }).click();
    await expect(card).toContainText("Sent to Codex.");
    await expect(
      page.locator(".project-message.child-thread .thread-frame"),
    ).toContainText("Second opinion:");

    // Its own thread opens on what it was asked, with the way back.
    await card.getByRole("button", { name: "Open" }).click();
    await expect(
      page.getByRole("heading", { name: /^Second opinion/ }),
    ).toBeVisible();
    const asked = page.getByRole("article", {
      name: "What the second opinion was asked",
    });
    await expect(asked).toContainText(
      "How does the cache avoid duplicate requests?",
    );
    await expect(asked).toContainText(
      "The cache guard prevents duplicate requests.",
    );
    await screenshot(page, { path: "test-results/second-opinion-thread.png" });
  } finally {
    await app?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
