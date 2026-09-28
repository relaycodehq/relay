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
import { fixtureServer, oldCode, newCode } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

async function launch(root: string) {
  const bin = join(root, "bin");
  await mkdir(bin);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
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
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      RELAY_AGENT_CAPTURE: join(root, "agent.jsonl"),
    },
  });
}

test("a chat file link with a line opens its local diff at that line", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-chat-line-")),
  );
  const repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(join(repo, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "README.md"), "# Lines\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  // Far taller than the pane, so line 250 is only on screen once scrolled to.
  await writeFile(
    join(repo, "src/long.ts"),
    Array.from({ length: 300 }, (_, i) => `export const n${i + 1} = 0;\n`).join(
      "",
    ),
  );
  const app = await launch(root);
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
    await page.getByLabel("Message project").fill("fixture long link");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.locator('.chat-file-link[title="src/long.ts:250"]').click();
    const local = page.getByRole("region", { name: "Local changes" });
    await expect(local.locator(".working-file.selected")).toContainText(
      "long.ts",
    );
    await expect(local.locator('[data-line="250"]').first()).toBeInViewport();
    await expect(page.locator(".project-file-list")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a chat file link in a PR thread selects the file in the review", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-chat-pr-")));
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
  const app = await launch(root);
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
    await page.getByLabel("Message project").fill("fixture pr links");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const link = (path: string) =>
      page.locator(`.chat-file-link[title="${path}"]`);
    const selected = (path: string) =>
      page.locator(`.file-row.active[title="${path}"]`);
    // The review loads the file list's second page to find this one.
    await link("src/components/file-60.tsx").click();
    await expect(selected("src/components/file-60.tsx")).toBeVisible();
    await link("src/lib/cache.ts").click();
    await expect(selected("src/lib/cache.ts")).toBeVisible();
    // A file the PR doesn't touch says so and keeps the current file.
    await link("src/nowhere.ts").click();
    await expect(page.locator(".toast.error")).toContainText(
      "This pull request doesn’t change src/nowhere.ts.",
    );
    await expect(selected("src/lib/cache.ts")).toBeVisible();
    await expect(page.locator(".project-file-list")).toHaveCount(0);
  } finally {
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
