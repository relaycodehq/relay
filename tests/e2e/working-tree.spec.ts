import { GiteaRepositoryVerifier } from "../../server/repository-access";
import { openSignIn, openInbox } from "../fixtures/navigation";
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
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureServer, newCode } from "../fixtures/gitea";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
let root: string,
  origin: string,
  rooms: ReturnType<typeof createRoomsServer>,
  db: RoomsDatabase,
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
  db = new RoomsDatabase(join(root, "rooms.sqlite"));
  const setup = token();
  rooms = createRoomsServer(
    db,
    setup,
    new GiteaRepositoryVerifier([fixture.serverUrl]),
  );
  await new Promise<void>((r) => rooms.listen(0, "127.0.0.1", r));
  const roomUrl = `http://127.0.0.1:${(rooms.address() as any).port}`;
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
      execFileSync("git", ["clone", "-q", "-b", "review", origin, repo]);
      git(repo, "config", "user.name", person);
      git(repo, "config", "user.email", person + "@example.invalid");
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
    await page
      .getByRole("button", { name: /Make pull request reviews faster/ })
      .click();
    if (person === "alice")
      await page.evaluate(
        async ({ roomUrl, setup }) =>
          window.relay.saveRoomHosting({ server: roomUrl, secret: setup }),
        { roomUrl, setup },
      );
  }
  await pages[0].evaluate(
    ({ ref, roomUrl }) => window.relay.allowRoomAccess(ref, roomUrl),
    { ref, roomUrl },
  );
  const invitation = await pages[0].evaluate(
    (ref) => window.relay.roomInvite(ref),
    ref,
  );
  await pages[1].evaluate(
    (code) => window.relay.roomAcceptInvitation(code),
    invitation.code,
  );
});
test.afterAll(async () => {
  for (const app of apps) await app.close().catch(() => {});
  await new Promise<void>((r) => rooms?.close(() => r()));
  db?.close();
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
  await page.screenshot({
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
test("two hidden desktops sync local edits, show a conflict and resolve it deliberately", async () => {
  for (const page of pages) {
    if (page === pages[1])
      await page
        .getByRole("button", { name: "Local changes", exact: true })
        .click();
    await page.getByRole("button", { name: "Live sync", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable / resume live sync", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause live sync", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await writeFile(join(repos[0], path), newCode + "\n// Shared from Alice\n");
  await expect
    .poll(() => readFile(join(repos[1], path), "utf8"), { timeout: 20000 })
    .toContain("Shared from Alice");
  expect(git(repos[1], "diff", "--cached")).toBe("");
  // Stop both clocks so neither machine wins before both independent edits exist.
  for (const page of pages)
    await page.evaluate((ref) => window.relay.liveSyncStop(ref), ref);
  await writeFile(
    join(repos[0], path),
    newCode + "\n// Alice concurrent edit\n",
  );
  await writeFile(join(repos[1], path), newCode + "\n// Bob concurrent edit\n");
  await pages[0].evaluate((ref) => window.relay.liveSyncStart(ref), ref);
  await pages[1].evaluate((ref) => window.relay.liveSyncStart(ref), ref);
  const bob = pages[1];
  await bob
    .getByRole("button", { name: "1 sync conflicts", exact: true })
    .click();
  await bob.getByRole("button", { name: new RegExp(path + " Alice") }).click();
  await expect(
    bob.getByRole("button", { name: "Use shared version", exact: true }),
  ).toBeVisible();
  await expect(
    bob.getByRole("dialog").locator("diffs-container"),
  ).toBeVisible();
  await bob.screenshot({
    path: resolve("test-results/screenshots/31-sync-conflict.png"),
  });
  await bob
    .getByRole("button", { name: "Use shared version", exact: true })
    .click();
  await expect
    .poll(() => readFile(join(repos[1], path), "utf8"))
    .toContain("Alice concurrent edit");
  expect(git(repos[1], "diff", "--cached")).toBe("");
  for (const app of apps)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
});
