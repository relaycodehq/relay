import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer, oldCode, newCode } from "../fixtures/gitea";
import { openInbox, openPull, pullsNav } from "../fixtures/navigation";

test("a project's PR opens on its thread with the Review, and the page keeps the project it was opened from", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-pulls-"))),
    repo = join(root, "project"),
    fixture = await fixtureServer(),
    path = "src/hooks/useReview.ts";
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  let app: ElectronApplication | undefined;
  try {
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
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: {
        ...env,
        RELAY_TEST_DATA: join(root, "data"),
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    const projectId = await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      return (await window.relay.addProject())!.id;
    }, fixture.serverUrl);
    await page.reload();
    const prThreads = () =>
      page.evaluate(
        async (id) =>
          (await window.relay.projectChats(id)).filter(
            (c) => c.scope.kind === "pr" && c.scope.ref.number === 7,
          ).length,
        projectId,
      );

    // The repository has a clone here, so its card is the project's.
    await openInbox(page);
    await expect(page.locator(".pulls-card")).toHaveCount(1);
    await expect(page.locator(".pulls-card.remote")).toHaveCount(0);
    await page.locator(".pulls-card-head").click();
    await expect(
      page.getByRole("heading", { name: /^Waiting on you/ }),
    ).toBeVisible();
    await expect(page.locator(".pulls-title")).toContainText("Pull requests");

    // Opened from there, it's the project's PR thread with the Review beside it.
    await openPull(page, /Make pull request reviews/);
    await expect(page.locator("diffs-container")).toBeVisible();
    await expect(page.locator(".project-review")).toBeVisible();
    await expect(pullsNav(page)).not.toHaveAttribute("aria-current", "page");
    expect(await prThreads()).toBe(1);

    // The page comes back on that project; opening the PR again reuses its thread.
    await openInbox(page);
    await expect(
      page.getByRole("heading", { name: /^Waiting on you/ }),
    ).toBeVisible();
    await openPull(page, /Make pull request reviews/);
    await expect(page.locator(".project-review")).toBeVisible();
    expect(await prThreads()).toBe(1);

    // On the page, Pull requests goes back to the board.
    await openInbox(page);
    await pullsNav(page).click();
    await expect(
      page.getByRole("heading", { name: /^Needs you/ }),
    ).toBeVisible();
  } finally {
    await app?.close().catch(() => {});
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
