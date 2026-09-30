import { openSignIn, openInbox, openPull } from "../fixtures/navigation";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureServer } from "../fixtures/gitea";

test("Gitea single line comments read in the conversation, in order", async () => {
  const fixture = await fixtureServer({ singleComments: true });
  const dataDir = await mkdtemp(join(tmpdir(), "relay-conversation-"));
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
    await page.getByRole("button", { name: "Conversation" }).click();

    const cards = page.locator(".conversation .discussion-card");
    // Description, two single-comment reviews, the reply, then the undated
    // fixture review with its own line comment.
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(1)).toContainText(
      "Why not reuse the controller from the parent hook?",
    );
    await expect(cards.nth(1)).toContainText("src/hooks/useReview.ts:14");
    await expect(cards.nth(2)).toContainText(
      "This drops the error on the floor.",
    );
    await expect(cards.nth(3)).toContainText("Pushed a fix for both.");
    await expect(cards.nth(4)).toContainText(
      "A couple of thoughts on error handling.",
    );
    await expect(cards.nth(4)).toContainText("Could we check response.ok");
    await page
      .locator(".conversation")
      .screenshot({ path: test.info().outputPath("conversation.png") });

    await cards
      .nth(1)
      .getByRole("button", { name: /useReview.ts:14/ })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Current file" }),
    ).toHaveValue("src/hooks/useReview.ts");
  } finally {
    await app.close();
    await fixture.close();
  }
});
