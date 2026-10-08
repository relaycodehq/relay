import { screenshot } from "../fixtures/screenshot";
import { openInbox, openPull } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureServer, newCode } from "../fixtures/gitea";
let root: string,
  origin: string,
  fixture: Awaited<ReturnType<typeof fixtureServer>>;
const apps: ElectronApplication[] = [],
  pages: Page[] = [],
  repos: string[] = [];
const ref = { owner: "Web", name: "web-store", number: 7 },
  path = "src/hooks/useReview.ts";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-working-ui-")));
  origin = join(root, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", origin]);
  fixture = await fixtureServer({
    users: {
      "test-alice": { id: 101, login: "alice", full_name: "Alice" },
      "test-bob": { id: 102, login: "bob", full_name: "Bob" },
    },
  });
  for (const person of ["alice", "bob"]) {
    const repo = join(root, person + "-repo");
    repos.push(repo);
    if (person === "alice") {
      await mkdir(repo);
      git(repo, "init", "-q", "-b", "review");
      git(repo, "config", "user.name", person);
      git(repo, "config", "user.email", person + "@example.invalid");
      git(repo, "remote", "add", "origin", origin);
      await mkdir(join(repo, "src/hooks"), { recursive: true });
      await writeFile(join(repo, path), newCode);
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "Base");
      git(repo, "push", "-qu", "origin", "review");
      fixture.setHead(git(repo, "rev-parse", "HEAD"));
    } else {
      // Bob's clone only checks that Alice's push reached the remote.
      execFileSync("git", ["clone", "-q", "-b", "review", origin, repo]);
      continue;
    }
    git(
      repo,
      "remote",
      "add",
      "gitea",
      fixture.serverUrl + "/Web/web-store.git",
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
      ),
    ) as Record<string, string>;
    const app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: join(root, person + "-data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    apps.push(app);
    const page = await app.firstWindow();
    pages.push(page);
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(
      async ({ url, person, ref }) => {
        await window.relay.connect(url, `test-${person}`);
        await window.relay.linkFolder(ref);
      },
      { url: fixture.serverUrl, person, ref },
    );
    await page.reload();
    await openInbox(page);
    await openPull(page, /Make pull request reviews faster/);
  }
});
test.afterAll(async () => {
  for (const app of apps) await app.close().catch(() => {});
  await fixture?.close();
  await rm(root, { recursive: true, force: true });
});
test("reviews local diffs, stages, commits and pushes only on explicit click", async () => {
  const page = pages[0];
  await writeFile(join(repos[0], path), newCode + "\n// local improvement\n");
  await writeFile(
    join(repos[0], "new-file.ts"),
    "export const useful = true;\n",
  );
  await page
    .getByRole("button", { name: "Local changes", exact: true })
    .click();
  const view = page.getByRole("region", { name: "Local changes" });
  await expect(
    view.getByText("Working changes", { exact: false }),
  ).toBeVisible();
  await view
    .getByRole("button", { name: /Modified src\/hooks\/useReview.ts/ })
    .click();
  await expect(view.locator("diffs-container")).toBeVisible();
  await expect(
    view.getByText("// local improvement", { exact: true }),
  ).toBeVisible();
  await mkdir(resolve("test-results/screenshots"), { recursive: true });
  await screenshot(page, {
    path: resolve("test-results/screenshots/30-local-changes.png"),
  });
  await view
    .getByRole("checkbox", { name: `Stage ${path}`, exact: true })
    .click();
  await view.getByLabel("Commit message").fill("Fix from the review");
  await view
    .getByRole("button", { name: "Commit staged changes", exact: true })
    .click();
  await expect(view.getByRole("status")).toContainText("Committed locally");
  expect(git(repos[0], "status", "--porcelain")).toContain("?? new-file.ts");
  expect(git(repos[0], "rev-list", "--count", "@{upstream}..HEAD")).toBe("1");
  await view.getByRole("button", { name: "Push…", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("Fix from the review");
  await modal
    .getByRole("button", { name: "Push to origin/review", exact: true })
    .click();
  await expect(modal).toBeHidden();
  expect(git(repos[0], "rev-list", "--count", "@{upstream}..HEAD")).toBe("0");
  git(repos[1], "pull", "--ff-only");
});
