import { test, expect, _electron as electron } from "@playwright/test";
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
import { fixtureServer } from "../fixtures/gitea";

test("shows what an agent turn changed and opens that turn's diff", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-turn-changes-")),
  );
  const repo = join(root, "project"),
    bin = join(root, "bin");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const fixture = await fixtureServer();
  const app = await (async () => {
    await mkdir(repo);
    await mkdir(bin);
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
    await writeFile(join(repo, "README.md"), "# Cache\n");
    git("add", ".");
    git("commit", "-qm", "Base");
    // Uncommitted work from before the turn stays out of its card.
    await writeFile(join(repo, "notes.txt"), "mine\n");
    await writeFile(
      join(bin, "codex"),
      `#!${process.execPath}\n` +
        (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
      { mode: 0o700 },
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    return electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        PATH: bin + ":" + env.PATH,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        RELAY_AGENT_CAPTURE: join(root, "agent.jsonl"),
      },
    });
  })();
  try {
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
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    const prompt = page.getByLabel("Message project");
    await prompt.fill("fixture edit files");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const card = page.getByRole("region", { name: "Changed files" });
    await expect(card).toContainText("2 changed files");
    await expect(card).toContainText("+2");
    await expect(card).not.toContainText("notes.txt");
    await expect(card.getByRole("button", { name: /guard\.ts/ })).toBeVisible();
    await card.screenshot({ path: "test-results/turn-changes-card.png" });

    await card.getByRole("button", { name: /guard\.ts/ }).click();
    const turn = page.getByRole("region", { name: "Turn changes" });
    await expect(turn).toContainText("Changed in this turn");
    await expect(turn).toContainText("Before turn → After turn");
    await expect(turn.locator(".working-review strong")).toHaveText(
      "src/guard.ts",
    );
    await expect(turn.getByText("export const guard = true;")).toBeVisible();
    await turn.getByRole("button", { name: /README\.md/ }).click();
    await expect(turn.getByText("Edited by the agent.")).toBeVisible();
    await page.screenshot({ path: "test-results/turn-changes-pane.png" });

    // Hovering a file offers to roll back just that file.
    const readme = join(repo, "README.md"),
      guard = join(repo, "src", "guard.ts");
    await card.getByRole("button", { name: /README\.md/ }).hover();
    await card.screenshot({ path: "test-results/turn-changes-hover.png" });
    await card
      .getByRole("button", { name: "Roll back this file to before this turn" })
      .last()
      .click();
    await expect(card).toContainText("1 rolled back");
    expect(await readFile(readme, "utf8")).toBe("# Cache\n");
    expect(await readFile(guard, "utf8")).toContain("guard");
    // The header rolls back the rest of the turn; redo brings it all back.
    await card.getByRole("button", { name: "Roll back", exact: true }).click();
    await expect(card).toContainText("Rolled back");
    await expect(readFile(guard, "utf8")).rejects.toThrow();
    await card.screenshot({ path: "test-results/turn-changes-reverted.png" });
    await card.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(card).not.toContainText("Rolled back");
    expect(await readFile(readme, "utf8")).toContain("Edited by the agent.");
    expect(await readFile(guard, "utf8")).toContain("guard");
    expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("mine\n");

    // An edit on top of the turn's own line conflicts until overwritten.
    await writeFile(readme, "# Cache\nEdited by me.\n");
    await card.getByRole("button", { name: /README\.md/ }).hover();
    await card
      .getByRole("button", { name: "Roll back this file to before this turn" })
      .last()
      .click();
    await expect(card.getByRole("alert")).toContainText(
      "README.md was edited after this turn",
    );
    expect(await readFile(readme, "utf8")).toBe("# Cache\nEdited by me.\n");
    await card.getByRole("button", { name: "Overwrite anyway" }).click();
    await expect(card).toContainText("1 rolled back");
    expect(await readFile(readme, "utf8")).toBe("# Cache\n");

    // The next turn hears about the rollback.
    await prompt.fill("what now");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect
      .poll(async () => readFile(join(root, "agent.jsonl"), "utf8"))
      .toContain("I rolled back your edits to README.md");

    await page.getByRole("button", { name: "Local changes" }).click();
    await expect(
      page.getByRole("region", { name: "Local changes" }),
    ).toBeVisible();
    // The turn's ref and the one rollback left to redo are kept once the
    // unchanged follow-up turn drops its own, and the user's index is untouched.
    await expect
      .poll(() =>
        git("for-each-ref", "--format=%(refname)", "refs/relay").split("\n"),
      )
      .toEqual([
        expect.stringMatching(
          /^refs\/relay\/reverts\/[0-9a-f-]{36}\/[0-9a-f]+$/,
        ),
        expect.stringMatching(/^refs\/relay\/turns\/[0-9a-f-]{36}$/),
      ]);
    expect(git("diff", "--cached", "--name-only")).toBe("");
  } finally {
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
