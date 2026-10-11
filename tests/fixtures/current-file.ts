import { expect, type Page } from "@playwright/test";

/**
 * The review toolbar's searchable file picker, with the calls the specs made
 * on the native select it replaced.
 */
export function currentFilePicker(page: Page) {
  const trigger = page.getByRole("button", { name: "Current file" });
  // The middle-truncated path keeps the whole of it in its tooltip.
  const path = trigger.locator(".middle-truncate");
  return {
    trigger,
    async selectOption(file: string) {
      await trigger.click();
      await page.getByRole("option", { name: file, exact: true }).click();
    },
    expectValue: (file: string) => expect(path).toHaveAttribute("title", file),
    inputValue: async () => (await path.getAttribute("title")) ?? "",
  };
}
