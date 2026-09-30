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

const PR_TITLE = "Make pull request reviews faster";
const PR_THREAD = "PR #7";

test("keeps a started PR review in the sidebar and remembers the sidebar beside its pane", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-pr-sidebar-")),
    ),
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
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
      localStorage.setItem("relay-sidebar-auto-hide", "on");
    }, fixture.serverUrl);
    await page.reload();
    const sidebar = page.locator(".projects-sidebar");
    const openPr = async () => {
      await page
        .getByRole("button", { name: "Review a PR", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Search pull requests" })
        .fill("faster");
      await page.getByRole("option", { name: new RegExp(PR_TITLE) }).click();
      await page
        .getByRole("button", { name: "Review changes →", exact: true })
        .click();
      await expect(page.locator("diffs-container")).toBeVisible();
    };
    const newThread = async () => {
      await page
        .getByRole("button", { name: "New thread", exact: true })
        .click();
      await expect(page.locator(".pane-header")).toHaveCount(0);
    };

    // A PR only glanced at leaves no thread behind.
    await openPr();
    await expect(sidebar).toHaveClass(/overlay/);
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(sidebar).not.toHaveClass(/overlay/);
    await expect(sidebar).toContainText(PR_THREAD);
    await newThread();
    await expect(sidebar).not.toHaveClass(/overlay/);
    await expect(sidebar).not.toContainText(PR_THREAD);

    // Shown beside the Review once, it stays shown there; a viewed file keeps the thread.
    await openPr();
    await expect(sidebar).not.toHaveClass(/overlay/);
    await page.getByRole("button", { name: /^Viewed/ }).click();
    await expect(page.getByText(/1 of \d+ reviewed/)).toBeVisible();
    await newThread();
    await expect(sidebar).toContainText(PR_THREAD);
    await sidebar.getByText(PR_THREAD).first().click();
    await page
      .getByRole("button", { name: "Review changes →", exact: true })
      .click();
    await expect(page.locator("diffs-container")).toBeVisible();
    await expect(sidebar).not.toHaveClass(/overlay/);

    // Hidden beside it, it's hidden there again, and back with the chat alone.
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(sidebar).toHaveClass(/overlay/);
    await page.getByRole("button", { name: "Close review" }).click();
    await expect(sidebar).not.toHaveClass(/overlay/);
    await page
      .getByRole("button", { name: "Review changes →", exact: true })
      .click();
    await expect(sidebar).toHaveClass(/overlay/);
  } finally {
    await app?.close().catch(() => {});
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
