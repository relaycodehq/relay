import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { screenshot } from "../fixtures/screenshot";

test("settings search keeps its query, opens highlighted matches and scrolls to them", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-settings-search-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 720 });
    await expect(
      page.getByRole("button", { name: "View activity" }),
    ).toBeVisible();
    const openSettings = () =>
      page.keyboard.press(
        process.platform === "darwin" ? "Meta+Comma" : "Control+Comma",
      );
    await openSettings();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    const search = settings.getByRole("textbox", { name: "Search settings" });
    const content = settings.locator(".settings-content");
    const categories = settings.getByRole("navigation", {
      name: "Settings categories",
    });
    const cache = settings.getByRole("region", {
      name: "Prompt cache fire and ice",
      exact: true,
    });
    await search.fill("cache");
    await expect(
      settings.getByRole("heading", { name: "Search results" }),
    ).toBeVisible();
    await expect(settings.locator(".settings-result mark")).toHaveText([
      "cache",
      "cache",
    ]);
    await screenshot(page, {
      path: "test-results/screenshots/settings-search-results.png",
    });

    await settings
      .getByRole("button", {
        name: "Open Prompt cache fire and ice in Appearance",
      })
      .click();
    await expect(search).toHaveValue("cache");
    await expect(
      settings.getByRole("heading", { name: "Appearance", exact: true }),
    ).toBeVisible();
    await expect(cache).toHaveAttribute("data-search-match", "true");
    await expect(cache).toBeFocused();
    await expect(cache.locator("mark")).toHaveText(["cache", "cache"]);
    await expect
      .poll(() => content.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    const viewport = await content.boundingBox();
    const target = await cache.boundingBox();
    expect(target!.y).toBeGreaterThanOrEqual(viewport!.y);
    expect(target!.y + target!.height).toBeLessThanOrEqual(
      viewport!.y + viewport!.height,
    );
    await screenshot(page, {
      path: "test-results/screenshots/settings-search-destination.png",
    });

    await settings.getByRole("button", { name: "All search results" }).click();
    await expect(search).toHaveValue("cache");
    await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBe(0);
    await categories.getByRole("button", { name: "Appearance" }).click();
    await expect(search).toHaveValue("cache");
    await expect(cache).toBeFocused();
    await expect(
      categories.getByRole("button", { name: "Appearance" }),
    ).toHaveAttribute("aria-current", "page");

    // Keyword-only hits still identify the row, even without text to mark.
    await search.fill("newline");
    await settings
      .getByRole("button", {
        name: "Open Send messages with in Keyboard shortcuts",
      })
      .click();
    const send = settings.getByRole("region", {
      name: "Send messages with",
      exact: true,
    });
    await expect(search).toHaveValue("newline");
    await expect(send).toHaveAttribute("data-search-match", "true");
    await expect(send).toBeFocused();
    await expect(
      send.getByRole("button", { name: "Enter", exact: true }),
    ).toBeVisible();

    // Every word and repeated occurrence is highlighted, not just the title.
    await search.fill("message enter");
    const result = settings.getByRole("button", {
      name: "Open Send messages with in Keyboard shortcuts",
    });
    const sendHighlights = ["message", "Enter", "message", "Enter"];
    await expect(result.locator("mark")).toHaveText(sendHighlights);
    await result.click();
    await expect(send.locator("mark")).toHaveText(sendHighlights);

    // Browsing a category with no hits must remain possible.
    await search.fill("nothing-matches-this");
    await expect(
      settings.getByText("No settings match “nothing-matches-this”."),
    ).toBeVisible();
    await categories.getByRole("button", { name: "Appearance" }).click();
    await expect(search).toHaveValue("nothing-matches-this");
    await expect(settings.getByRole("status")).toHaveText(
      "0 matches for “nothing-matches-this”",
    );
    await settings.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(settings.locator("[data-search-match]")).toHaveCount(0);

    // Closing the page preserves the search; Escape explicitly clears it.
    await search.fill("cache");
    await settings.getByRole("button", { name: "Back to app" }).click();
    await expect(settings).toBeHidden();
    await openSettings();
    await expect(search).toHaveValue("cache");
    await expect(
      settings.getByRole("heading", { name: "Search results" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
