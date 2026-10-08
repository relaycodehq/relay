import { expect, type Page } from "@playwright/test";
/** The Gitea sign-in, offered by the Pull requests page while there's no `gh` login or Gitea. */
export async function openSignIn(page: Page) {
  if (await page.getByLabel("Gitea server", { exact: true }).isVisible())
    return;
  await pullsNav(page).click();
  await page.getByRole("button", { name: "Or connect a Gitea server" }).click();
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
