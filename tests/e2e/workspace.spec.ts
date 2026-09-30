import {
  openSignIn,
  openInbox,
  openPull,
  pullsNav,
} from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureServer } from "../fixtures/gitea";

test("finished PRs stay closed on restart, while new commits after an approval remain resumable", async () => {
  const fixture = await fixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "relay-finished-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  let app: ElectronApplication | undefined;
  let page: Page;
  const launch = async () => {
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: { ...env, RELAY_TEST_DATA: dataDir },
    });
    page = await app.firstWindow();
  };
  const open = () => openPull(page, /Make pull request reviews/);
  const board = () =>
    page.getByRole("heading", { name: "Pull requests", level: 1 });
  try {
    await launch();
    await openSignIn(page!);
    await page!
      .getByLabel("Gitea server", { exact: true })
      .fill(fixture.serverUrl);
    await page!
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page!
      .getByRole("button", { name: "Connect to Gitea", exact: true })
      .click();
    await openInbox(page!);
    await open();
    await expect(page!.locator("diffs-container")).toBeVisible();
    await page!
      .getByRole("button", { name: "Finish review", exact: true })
      .click();
    await page!.getByRole("radio", { name: /^Approve/ }).check();
    await page!
      .getByRole("button", { name: "Submit review", exact: true })
      .click();
    await expect(page!.getByRole("dialog")).toHaveCount(0);
    const boot = await page!.evaluate(() => window.relay.bootstrap());
    test.skip(
      !boot.account?.persistent,
      "System credential storage unavailable",
    );
    await app!.close();
    const start = fixture.requests.length;
    await launch();
    await expect(board()).toBeVisible();
    expect(
      fixture.requests
        .slice(start)
        .some((r) => r.path.includes("/raw/") || r.path.endsWith("/files")),
    ).toBe(false);

    // A manual open remains possible, and an old approval does not hide new work.
    fixture.setHead("c".repeat(40));
    await open();
    await expect(
      page!.getByRole("combobox", { name: "Current file" }),
    ).toHaveValue("src/hooks/useReview.ts");
    await expect
      .poll(async () =>
        page!.evaluate(
          async () => (await window.relay.bootstrap()).workspace.pull?.number,
        ),
      )
      .toBe(7);
    await page!.reload();
    await expect(page!.locator(".breadcrumb .pr-number")).toHaveText("#7");
    await expect(page!.locator("diffs-container")).toBeVisible();
    fixture.setPullState("closed");
    await page!.reload();
    await expect(board()).toBeVisible();
    fixture.setPullState("open", true);
    await open();
    await expect(
      page!.getByRole("combobox", { name: "Current file" }),
    ).toHaveValue("src/hooks/useReview.ts");
    await expect
      .poll(async () =>
        page!.evaluate(
          async () => (await window.relay.bootstrap()).workspace.pull?.number,
        ),
      )
      .toBe(7);
    await page!.reload();
    await expect(board()).toBeVisible();
  } finally {
    await app?.close();
    await fixture.close();
  }
});

test("restores the PR, late-page file and the page's search across reload/restart; explicit URLs take priority", async () => {
  const fixture = await fixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "relay-workspace-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  let app: ElectronApplication | undefined;
  let page: Page;
  const launch = async (url?: string) => {
    app = await electron.launch({
      args: ["tests/fixtures/launch.cjs", ...(url ? [url] : [])],
      env: { ...env, RELAY_TEST_DATA: dataDir },
    });
    page = await app.firstWindow();
  };
  const current = () => page.getByRole("combobox", { name: "Current file" });
  const workspace = () =>
    page.evaluate(async () => (await window.relay.bootstrap()).workspace);
  const path = "src/components/file-63.tsx";
  try {
    await launch();
    await openSignIn(page!);
    await page!
      .getByLabel("Gitea server", { exact: true })
      .fill(fixture.serverUrl);
    await page!
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page!
      .getByRole("button", { name: "Connect to Gitea", exact: true })
      .click();
    await openInbox(page!);
    await page!
      .getByRole("textbox", { name: "Search pull requests" })
      .fill("reviews");
    await page!.getByRole("radio", { name: "Closed", exact: true }).click();
    // The search is saved once it runs, so open the PR from its results.
    await expect(
      page!.getByRole("heading", { name: /^Results/ }),
    ).toBeVisible();
    await openPull(page!, /Make pull request reviews/);
    await expect(current()).toHaveValue("src/hooks/useReview.ts");
    await page!
      .getByRole("button", { name: "Load more files", exact: true })
      .click();
    await current().selectOption(path);
    await expect(page!.locator("diffs-container")).toBeVisible();
    await expect.poll(workspace).toEqual({
      pull: { owner: "Web", name: "web-store", number: 7 },
      file: path,
      filter: "review_requested",
      query: "reviews",
      state: "closed",
    });
    let start = fixture.requests.length;
    await page!.reload();
    await expect(current()).toHaveValue(path);
    await expect(page!.locator("diffs-container")).toBeVisible();
    let raw = fixture.requests
      .slice(start)
      .filter((r) => r.path.includes("/raw/"));
    expect(raw).toHaveLength(2);
    expect(raw.every((r) => r.path.endsWith(path))).toBe(true);
    expect(
      fixture.requests
        .slice(start)
        .filter((r) => r.path.endsWith("/files"))
        .map((r) => r.query.page),
    ).toEqual(["1", "2"]);

    const boot = await page!.evaluate(() => window.relay.bootstrap());
    // A full restart must restore without clicking a PR, including secure saved login.
    test.skip(
      !boot.account?.persistent,
      "System credential storage unavailable",
    );
    await app!.close();
    start = fixture.requests.length;
    await launch();
    await expect(current()).toHaveValue(path);
    await expect(page!.locator("diffs-container")).toBeVisible();
    raw = fixture.requests.slice(start).filter((r) => r.path.includes("/raw/"));
    expect(raw).toHaveLength(2);
    expect(raw.every((r) => r.path.endsWith(path))).toBe(true);
    const saved = JSON.parse(
      await readFile(join(dataDir, "state.json"), "utf8"),
    );
    expect(saved.workspaces[boot.account!.id].file).toBe(path);

    // An explicitly opened link wins over the saved PR and is consumed once.
    await app!.close();
    await launch(
      "relay://open?url=" +
        encodeURIComponent(fixture.serverUrl + "/Web/web-store/pulls/20"),
    );
    await expect(page!.locator(".breadcrumb .pr-number")).toHaveText("#20");
    // Back on the page, its search and state are as they were left.
    await pullsNav(page!).click();
    await expect(
      page!.getByRole("textbox", { name: "Search pull requests" }),
    ).toHaveValue("reviews");
    await expect(
      page!.getByRole("radio", { name: "Closed", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page!.getByRole("textbox", { name: "Search pull requests" }).fill("");
    await openPull(page!, /Make pull request reviews/);
    await expect(page!.locator(".breadcrumb .pr-number")).toHaveText("#7");
    await expect.poll(async () => (await workspace()).pull?.number).toBe(7);
    await page!.reload();
    await expect(page!.locator(".breadcrumb .pr-number")).toHaveText("#7");

    await app!.evaluate(
      ({ app }, url) => {
        app.emit("open-url", { preventDefault() {} }, url);
      },
      "relay://open?url=" +
        encodeURIComponent(fixture.serverUrl + "/Web/web-store/pulls/20"),
    );
    await expect(page!.locator(".breadcrumb .pr-number")).toHaveText("#20");
    await pullsNav(page!).click();
    await openPull(page!, /Make pull request reviews/);
    await expect.poll(async () => (await workspace()).pull?.number).toBe(7);
    await page!.reload();
    await expect(page!.locator(".breadcrumb .pr-number")).toHaveText("#7");

    // A removed path falls back only after checking the complete metadata list.
    await page!.evaluate(async () => {
      const { workspace } = await window.relay.bootstrap();
      await window.relay.saveWorkspace({
        ...workspace,
        file: "src/removed-file.ts",
      });
    });
    start = fixture.requests.length;
    await page!.reload();
    await expect(current()).toHaveValue("src/hooks/useReview.ts");
    await expect(page!.locator("diffs-container")).toBeVisible();
    expect(
      fixture.requests
        .slice(start)
        .filter((r) => r.path.endsWith("/files"))
        .map((r) => r.query.page),
    ).toEqual(["1", "2"]);
    expect(
      fixture.requests
        .slice(start)
        .filter((r) => r.path.includes("/raw/"))
        .every((r) => r.path.endsWith("src/hooks/useReview.ts")),
    ).toBe(true);
    expect(fixture.requests.some((r) => r.method !== "GET")).toBe(false);
  } finally {
    await app?.close();
    await fixture.close();
  }
});

test("keeps remembered reviews separate for each account and restores them after reconnecting", async () => {
  const first = await fixtureServer(),
    second = await fixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "relay-accounts-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: dataDir },
  });
  const page = await app.firstWindow();
  const connect = async (url: string) => {
    await openSignIn(page);
    await page.getByLabel("Gitea server", { exact: true }).fill(url);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page
      .getByRole("button", { name: "Connect to Gitea", exact: true })
      .click();
    await openInbox(page);
  };
  const disconnect = async () => {
    await page
      .getByRole("complementary", { name: "Projects" })
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page
      .getByRole("button", { name: "Disconnect account", exact: true })
      .click();
  };
  try {
    await connect(first.serverUrl);
    await openPull(page, /Make pull request reviews/);
    await page
      .getByRole("combobox", { name: "Current file" })
      .selectOption("src/lib/cache.ts");
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await window.relay.bootstrap()).workspace.file,
        ),
      )
      .toBe("src/lib/cache.ts");
    await disconnect();
    await connect(second.serverUrl);
    await expect(
      page.getByRole("heading", { name: "Pull requests", level: 1 }),
    ).toBeVisible();
    await openPull(page, /Improve session expiry/);
    await expect(page.locator(".breadcrumb .pr-number")).toHaveText("#20");
    await disconnect();
    await connect(first.serverUrl);
    await expect(page.locator(".breadcrumb .pr-number")).toHaveText("#7");
    await expect(
      page.getByRole("combobox", { name: "Current file" }),
    ).toHaveValue("src/lib/cache.ts");
  } finally {
    await app.close();
    await first.close();
    await second.close();
  }
});

test("the Pull requests page keeps its open PR after a visit to a chat", async () => {
  const fixture = await fixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "relay-inbox-return-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: dataDir },
  });
  try {
    const page = await app.firstWindow();
    await openSignIn(page);
    await page
      .getByLabel("Gitea server", { exact: true })
      .fill(fixture.serverUrl);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page
      .getByRole("button", { name: "Connect to Gitea", exact: true })
      .click();
    await openInbox(page);
    await openPull(page, /Make pull request reviews/);
    await expect(page.locator(".breadcrumb .pr-number")).toHaveText("#7");
    await page
      .getByRole("button", { name: "Ask anything", exact: true })
      .click();
    await expect(pullsNav(page)).not.toHaveAttribute("aria-current", "page");
    await openInbox(page);
    await expect(page.locator(".breadcrumb .pr-number")).toHaveText("#7");
    expect(
      (await page.evaluate(() => window.relay.bootstrap())).workspace.pull
        ?.number,
    ).toBe(7);
  } finally {
    await app.close();
    await fixture.close();
  }
});
