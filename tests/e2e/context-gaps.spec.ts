import { openSignIn, openInbox } from "../fixtures/navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureServer } from "../fixtures/gitea";
let app: ElectronApplication,
  page: Page,
  fixture: Awaited<ReturnType<typeof fixtureServer>>;
test.beforeAll(async () => {
  fixture = await fixtureServer({ contextGaps: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    RELAY_TEST_DATA: await mkdtemp(join(tmpdir(), "relay-gaps-")),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: env as Record<string, string>,
  });
  page = await app.firstWindow();
  await openSignIn(page);
  await page
    .getByLabel("Gitea server", { exact: true })
    .fill(fixture.serverUrl);
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("test-token");
  await page.getByRole("button", { name: "Connect to Gitea" }).click();
  await openInbox(page);
  await page.getByRole("button", { name: /Make pull request reviews/ }).click();
  await page
    .getByRole("combobox", { name: "Current file" })
    .selectOption("src/lib/cache.ts");
});
test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
});

// The gap controls don't depend on the layout, so one layout covers them.
test("visible gap controls expand chunks and whole gaps with mouse and keyboard", async () => {
  await page.reload();
  await expect(page.locator("diffs-container")).toBeVisible();
  await page
    .getByRole("button", { name: "Side by side diff", exact: true })
    .click();
  const rawRequests = fixture.requests.filter((r) =>
    r.path.includes("/raw/"),
  ).length;
  const gap = page.locator(
    '[data-gutter] [data-expand-index="1"] [data-separator-wrapper]:visible',
  );
  const label = gap.locator("[data-unmodified-lines]");
  await expect(label).toContainText("unchanged lines");
  const hidden = Number.parseInt((await label.textContent())!, 10);
  expect(hidden).toBeGreaterThan(40);
  await expect(
    gap.getByRole("button", {
      name: `Expand all ${hidden} unchanged lines`,
      exact: true,
    }),
  ).toBeVisible();
  const band = await gap.evaluate((el) => {
    const parent = el.parentElement!;
    return {
      background: getComputedStyle(parent).backgroundColor,
      height: parent.getBoundingClientRect().height,
      labelWidth: el
        .querySelector("[data-unmodified-lines]")!
        .getBoundingClientRect().width,
      controlHeight: el
        .querySelector("[data-expand-button]")!
        .getBoundingClientRect().height,
    };
  });
  expect(band.height).toBe(32);
  expect(band.labelWidth).toBeGreaterThan(100);
  expect(band.controlHeight).toBeGreaterThanOrEqual(24);
  expect(band.background).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator('[data-column-number="20"]')).toHaveCount(0);
  await label.click();
  await expect(label).toContainText(`${hidden - 40} unchanged lines`);
  await expect(page.locator('[data-column-number="20"]').last()).toBeVisible();
  await label.focus();
  await label.press("Shift+Enter");
  await expect(gap).toHaveCount(0);
  // Expanded context retains real file line numbers for review actions.
  await page.locator('[data-column-number="20"]').last().click();
  await page
    .getByRole("button", { name: "Mark for later", exact: true })
    .click();
  await expect(page.getByText("Marked for later · lines 20–20")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove line mark", exact: true })
    .click();
  expect(fixture.requests.filter((r) => r.path.includes("/raw/")).length).toBe(
    rawRequests,
  );
  await page.locator(".diff-code-view").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.locator(
      '[data-gutter] [data-expand-index="2"] [data-unmodified-lines]:visible',
    ),
  ).toContainText("unchanged lines");
  const nextGap = page.locator(
    '[data-gutter] [data-expand-index="2"] [data-separator-wrapper]:visible',
  );
  const nextLabel = nextGap.locator("[data-unmodified-lines]");
  const nextHidden = Number.parseInt((await nextLabel.textContent())!, 10);
  await nextGap.locator("[data-expand-up]").click();
  await expect(nextLabel).toContainText(`${nextHidden - 20} unchanged lines`);
  await nextGap
    .getByRole("button", {
      name: `Expand all ${nextHidden - 20} unchanged lines`,
      exact: true,
    })
    .click();
  await expect(nextGap).toHaveCount(0);
  await expect(page.locator("[data-line]")).not.toHaveCount(0);
});
