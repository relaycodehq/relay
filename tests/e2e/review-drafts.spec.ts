import { openSignIn, openInbox, openPull } from "../fixtures/navigation";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureServer } from "../fixtures/gitea";

test("a line comment closed without text leaves no draft behind", async () => {
  const fixture = await fixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "relay-empty-draft-"));
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
    const current = page.getByRole("combobox", { name: "Current file" });
    const drafts = () =>
      page.evaluate(
        async () =>
          (
            await window.relay.progress({
              owner: "Web",
              name: "web-store",
              number: 7,
            })
          ).drafts,
      );
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
    await expect(current).toHaveValue("src/hooks/useReview.ts");
    for (const typed of ["", "Not this one"]) {
      await page.locator('[data-column-number="20"]').last().click();
      await page.getByRole("button", { name: "Comment", exact: true }).click();
      const box = page.getByRole("textbox", {
        name: "Line comment",
        exact: true,
      });
      if (typed) {
        await box.fill(typed);
        await expect.poll(async () => (await drafts()).length).toBe(1);
        await box.fill("");
      } else await expect(box).toBeVisible();
      // Leave the file with the box still open.
      await current.selectOption("src/components/ReviewPane.tsx");
      await expect(page.locator("diffs-container")).toBeVisible();
      await current.selectOption("src/hooks/useReview.ts");
      await expect(page.locator("diffs-container")).toBeVisible();
      expect(await drafts()).toEqual([]);
    }
  } finally {
    await app.close();
    await fixture.close();
  }
});
