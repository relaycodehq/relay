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
