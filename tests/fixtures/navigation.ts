import { expect, type Page } from "@playwright/test";
/**
 * The Gitea sign-in, offered by the Pull requests page while there's no `gh`
 * login or Gitea. Turns Gitea on first: a new profile starts with it off.
 */
export async function openSignIn(page: Page) {
  if (await page.getByLabel("Gitea server", { exact: true }).isVisible())
    return;
  if (
    !(await page.evaluate(async () => (await window.relay.bootstrap()).gitea))
  ) {
    await page.evaluate(() =>
      window.relay.setSourceControlEnabled("gitea", true),
    );
    await page.reload();
  }
  await pullsNav(page).click();
  await page.getByRole("button", { name: "Or connect a Gitea server" }).click();
}
/** Settings → Integrations with the Gitea row's details open. */
export async function openGiteaSettings(page: Page) {
  await page
    .getByRole("complementary", { name: "Projects" })
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  // The rows wait on a scan of the CLIs first.
  const chevron = page.getByRole("button", {
    name: /^(Show|Hide) Gitea details$/,
  });
  await expect(chevron).toBeVisible();
  if ((await chevron.getAttribute("aria-label"))?.startsWith("Show"))
    await chevron.click();
  return page.getByRole("region", { name: "Source control" });
}
/** The sidebar's Pull requests: opens the page, and on it goes back to the board. */
export const pullsNav = (page: Page) =>
  page
    .getByRole("complementary", { name: "Projects" })
    .getByRole("button", { name: "Pull requests", exact: true });
/** Opens the Pull requests page where it was left, unless it's showing. */
export async function openInbox(page: Page) {
  const button = pullsNav(page);
  if (
    (await button.isVisible()) &&
    (await button.getAttribute("aria-current")) !== "page"
  )
    await button.click();
}
/**
 * Opens a PR from the Pull requests page, unless a reload already reopened
 * it. One waiting on you shows twice there, as a tile and on its project's
 * card; either opens it.
 */
export async function openPull(page: Page, title: RegExp | string) {
  const open = page
    .locator(".review-main")
    .getByRole("heading", { name: title });
  const board = page.locator(".pulls-page");
  await expect(open.or(board).first()).toBeVisible();
  if (await board.isVisible())
    await page.getByRole("button", { name: title }).first().click();
}
/** Opens a file in the Files pane's tree, unfolding each folder on the way. */
export async function openInFileTree(page: Page, path: string) {
  const tree = page.locator(".file-tree");
  for (const name of path.split("/"))
    await tree.getByRole("treeitem", { name, exact: true }).click();
}

/** The panel's toggle in the title bar's strip. */
export const panelToggle = (page: Page) =>
  page
    .getByRole("group", { name: "Workspace panes" })
    .getByRole("button", { name: /^Panel\b/ });

/** Brings a surface to the front of the panel, opening the panel and the surface as needed. */
export async function openSurface(
  page: Page,
  name: "Files" | "History" | "Terminal" | "Browser",
) {
  const toggle = panelToggle(page);
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  const panel = page.locator('[data-pane="panel"]');
  await expect(panel.locator(".pane-header")).toBeVisible();
  const tab =
    name === "Browser"
      ? panel
          .locator(".pane-tab-host")
          .filter({
            has: page.getByRole("button", {
              name: "Close browser",
              exact: true,
            }),
          })
          .getByRole("tab")
      : panel.getByRole("tab", { name, exact: true });
  if (name !== "Terminal" && (await tab.isVisible())) return tab.click();
  const item = panel
    .locator(".surface-picker")
    .getByRole("button", { name, exact: true });
  if (!(await item.isVisible()))
    await panel
      .getByRole("button", { name: "Open another surface", exact: true })
      .click();
  await item.click();
}
