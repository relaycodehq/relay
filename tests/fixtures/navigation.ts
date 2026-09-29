import type { Page } from "@playwright/test";
export async function openSignIn(page: Page) {
  if (!(await page.getByLabel("Gitea server", { exact: true }).isVisible()))
    await page
      .getByRole("button", { name: "Connect Gitea", exact: true })
      .click();
}
export async function openInbox(page: Page) {
  const button = page.getByRole("button", {
    name: "Pull requests",
    exact: true,
  });
  if (await button.isVisible()) await button.click();
}
/** Opens a file in the Files pane's tree, unfolding each folder on the way. */
export async function openInFileTree(page: Page, path: string) {
  const tree = page.locator(".file-tree");
  for (const name of path.split("/"))
    await tree.getByRole("treeitem", { name, exact: true }).click();
}
