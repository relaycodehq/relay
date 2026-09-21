import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixtureServer, BASE, HEAD } from "../fixtures/gitea";
import { TRIAGE_MODEL, TRIAGE_VERSION } from "../../shared/triage";

test("group actions keep the sidebar position while explicit file navigation reveals its target", async () => {
  const fixture = await fixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "relay-group-scroll-"));
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
    await page
      .getByLabel("Gitea server", { exact: true })
      .fill(fixture.serverUrl);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page.getByRole("button", { name: "Connect to Gitea" }).click();
    await page
      .getByRole("button", { name: /Make pull request reviews/ })
      .click();
    await expect(page.locator("diffs-container")).toBeVisible();
    const { account, files } = await page.evaluate(async () => {
      const ref = { owner: "Web", name: "web-store", number: 7 };
      const boot = await window.relay.bootstrap();
      const first = await window.relay.files(ref, 1);
      const second = await window.relay.files(ref, 2);
      return {
        account: boot.account!.id,
        files: [...first.items, ...second.items],
      };
    });
    const path = (i: number) => `src/components/file-${i}.tsx`;
    const groups = [
      {
        id: "a",
        name: "Shared API update",
        description: "First repeated edit.",
        paths: [0, 4, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11].map(path),
      },
      {
        id: "b",
        name: "Shared styling update",
        description: "Second repeated edit.",
        paths: [path(13), path(12)],
      },
      {
        id: "c",
        name: "Shared configuration update",
        description: "Third repeated edit.",
        paths: [path(14), path(15)],
      },
      {
        id: "d",
        name: "Shared import update",
        description: "Fourth repeated edit.",
        paths: [path(16), path(17)],
      },
    ];
    const grouped = new Set(groups.flatMap((g) => g.paths));
    const key = JSON.stringify([account, "Web", "web-store", 7]);
    await mkdir(join(dataDir, "analysis"), { recursive: true });
    await writeFile(
      join(
        dataDir,
        "analysis",
        createHash("sha256").update(key).digest("hex") + ".json",
      ),
      JSON.stringify({
        version: TRIAGE_VERSION,
        revision: `${BASE}:${HEAD}`,
        model: TRIAGE_MODEL,
        createdAt: new Date().toISOString(),
        files,
        groups,
        ordinary: Object.fromEntries(
          files
            .filter((f) => !grouped.has(f.filename))
            .map((f) => [f.filename, "Independent change."]),
        ),
        usage: { inputTokens: 0, outputTokens: 0, batches: 0 },
      }),
    );
    await page.reload();
    const current = page.getByRole("combobox", { name: "Current file" });
    const list = page.locator(".file-virtual");
    const group = (name: string) =>
      page
        .locator(".change-group")
        .filter({ has: page.getByRole("button", { name, exact: true }) });
    const header = (name: string) => group(name).locator(".group-heading");
    const expectOffset = async (offset: number) => {
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(offset);
      // Allow effect-driven scrolling to run too, rather than checking only the click frame.
      await list.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      expect(await list.evaluate((el) => el.scrollTop)).toBe(offset);
    };
    const expectSelectionInView = async () => {
      await expect
        .poll(() =>
          list.evaluate((el) => {
            const selected = el.querySelector(".file-row.active");
            if (!selected) return false;
            const row = selected.getBoundingClientRect(),
              pane = el.getBoundingClientRect();
            return row.top >= pane.top - 1 && row.bottom <= pane.bottom + 1;
          }),
        )
        .toBe(true);
    };
    await expect(
      page.getByText("4 groups · 18 files", { exact: true }),
    ).toBeVisible();
    const press = async (key: string) => {
      await page
        .getByRole("heading", {
          name: "Make pull request reviews faster and more reliable",
          exact: true,
        })
        .click();
      await page.keyboard.press(key);
    };
    const resetProgress = async () => {
      await page.evaluate(() =>
        window.relay.saveProgress(
          { owner: "Web", name: "web-store", number: 7 },
          { read: {}, drafts: [], marks: [] },
        ),
      );
      await page.reload();
      await expect(
        page.getByText("0 of 72 reviewed", { exact: true }),
      ).toBeVisible();
    };
    // Deliberately different from repository order: 0 → 4 → 1, then 13 → 12.
    await current.selectOption(path(4));
    await press("v");
    await expect(current).toHaveValue(path(1));
    await expectSelectionInView();
    await current.selectOption(path(0));
    await press("v");
    await expect(current).toHaveValue(path(1)); // Skip already viewed 4.
    await current.selectOption(path(11));
    await press("v");
    await expect(current).toHaveValue(path(13));
    await expectSelectionInView();
    await press("v");
    await expect(current).toHaveValue(path(12));
    await press("v");
    await expect(current).toHaveValue(path(14));
    await current.selectOption(path(11));
    await press("v"); // Unmarking stays put.
    await expect(current).toHaveValue(path(11));
    await press("v");
    await expect(current).toHaveValue(path(14)); // Skip the complete second group.
    await current.selectOption(path(17));
    await press("v");
    await expect(current).toHaveValue("src/hooks/useReview.ts");
    await press("k");
    await expect(current).toHaveValue(path(17));
    await press("j");
    await expect(current).toHaveValue("src/hooks/useReview.ts");
    await resetProgress();
    await page
      .getByRole("button", { name: "Show all files", exact: true })
      .click();
    await current.selectOption(path(0));
    await press("v");
    await expect(current).toHaveValue(path(1)); // Flat mode follows repository order.
    await resetProgress();
    await current.selectOption(path(63));
    await expectSelectionInView();
    await list.evaluate((el) => {
      el.scrollTop = 60;
    });
    const b = "Shared styling update 2";
    await header(b).click();
    await expect(header(b)).toHaveAttribute("aria-expanded", "true");
    await expectOffset(60);
    await header(b).click();
    await expect(header(b)).toHaveAttribute("aria-expanded", "false");
    await expectOffset(60);
    await header(b).click();
    await group(b)
      .getByRole("button", { name: "About Shared styling update", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Second repeated edit.",
    );
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: path(12), exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expectOffset(60);
    await group(b)
      .getByRole("button", { name: "Mark as viewed", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(current).toHaveValue(path(63));
    await expect(header(b)).toHaveAttribute("aria-expanded", "false");
    await expectOffset(60);

    // Reviewing the selected group advances the diff without dragging the sidebar
    // to that next file or reopening its group. Ordinary navigation still reveals it.
    const a = "Shared API update 12",
      c = "Shared configuration update 2";
    await current.selectOption(path(0));
    await expectSelectionInView();
    await list.evaluate((el) => {
      el.scrollTop = 0;
    });
    await header(a).click();
    await expect(header(a)).toHaveAttribute("aria-expanded", "false");
    await expectOffset(0);
    await group(a)
      .getByRole("button", { name: "Mark as viewed", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(current).toHaveValue(path(14));
    await expect(header(a)).toHaveAttribute("aria-expanded", "false");
    await expect(header(c)).toHaveAttribute("aria-expanded", "false");
    await expectOffset(0);
    await expect(
      page.getByText("14 of 72 reviewed", { exact: true }),
    ).toBeVisible();
    await mkdir(resolve("test-results/screenshots"), { recursive: true });
    await page.screenshot({
      path: resolve("test-results/screenshots/20-group-scroll-stable.png"),
    });
    await page
      .getByRole("button", { name: "Next file · J", exact: true })
      .click();
    await expect(current).toHaveValue(path(15));
    await expect(header(c)).toHaveAttribute("aria-expanded", "true");
    await expectSelectionInView();
    await current.selectOption(path(63));
    await expectSelectionInView();
    await list.evaluate((el) => {
      el.scrollTop = 60;
    });
    await group(b)
      .getByRole("button", { name: "Mark as unviewed", exact: true })
      .click();
    await expect(
      group(b).getByRole("button", { name: "Mark as viewed", exact: true }),
    ).toBeEnabled();
    await expectOffset(60);
    await expect(
      page.getByText("12 of 72 reviewed", { exact: true }),
    ).toBeVisible();
    fixture.setHead("c".repeat(40));
    await group(b)
      .getByRole("button", { name: "Mark as viewed", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "This PR has new commits.",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("12 of 72 reviewed", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expectOffset(60);
    expect(fixture.requests.some((r) => r.method !== "GET")).toBe(false);
  } finally {
    await app.close();
    await fixture.close();
  }
});
