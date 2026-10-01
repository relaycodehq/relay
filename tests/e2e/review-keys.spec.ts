import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer, oldCode, newCode } from "../fixtures/gitea";
import { openInFileTree } from "../fixtures/navigation";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("the review's plain-key shortcuts stay out of the code editor", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-keys-")));
  const repo = join(root, "project"),
    fixture = await fixtureServer(),
    path = "src/hooks/useReview.ts";
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  await mkdir(join(repo, "src/hooks"), { recursive: true });
  git("init", "-q", "-b", "review");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
  await writeFile(join(repo, path), oldCode);
  git("add", ".");
  git("commit", "-qm", "Base");
  fixture.setBase(git("rev-parse", "HEAD"));
  await writeFile(join(repo, path), newCode);
  git("commit", "-qam", "Head");
  fixture.setHead(git("rev-parse", "HEAD"));
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
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    await page
      .getByRole("button", { name: "Review a PR", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Search pull requests" })
      .fill("faster");
    await page
      .getByRole("option", { name: /Make pull request reviews faster/ })
      .click();
    const panes = page.getByRole("group", { name: "Workspace panes" });
    await panes.getByRole("button", { name: /^PR #7\b/ }).click();
    const active = page.locator(".file-row.active");
    await expect(active).toHaveCount(1);
    const first = await active.getAttribute("title");

    // Outside a text field, J and K move through the review.
    await active.click();
    await page.keyboard.press("j");
    await expect(active).not.toHaveAttribute("title", first!);
    await page.keyboard.press("k");
    await expect(active).toHaveAttribute("title", first!);

    // Typed in the code editor, which types inside a shadow root, they're text.
    await panes.getByRole("button", { name: /^Files\b/ }).click();
    await openInFileTree(page, path);
    const editor = page
      .locator(".project-inline-editor")
      .getByRole("textbox", { name: path, exact: true });
    await editor.press(`${modifier}+End`);
    await editor.pressSequentially("jk");
    await expect(editor).toContainText("jk");
    await expect(active).toHaveAttribute("title", first!);
    await editor.press(`${modifier}+s`);
    await expect(page.locator(".editor-bar-state")).toHaveText("Saved");
  } finally {
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
