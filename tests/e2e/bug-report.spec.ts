import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { screenshot } from "../fixtures/screenshot";
import type { BugReportDraft } from "../../shared/bug-report";

test("report drafts save across discard and screenshots share the edited preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-report-ui-"));
  const data = join(root, "data");
  await mkdir(data, { recursive: true });
  const app = await electron.launch({
    env: {
      ...relayEnv(),
      RELAY_TEST_DATA: data,
      GH_CONFIG_DIR: join(root, "github"),
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    },
  });
  const saved = async (): Promise<BugReportDraft | undefined> => {
    try {
      return JSON.parse(
        await readFile(join(data, "bug-report", "draft.json"), "utf8"),
      );
    } catch {
      return undefined;
    }
  };
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 1100 });
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
    await settings
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Report a problem" })
      .click();
    const report = settings.locator(".report-problem");
    const title = report.locator('input[maxlength="256"]');
    await title.fill("Sample report before discard");
    await report
      .locator("textarea")
      .fill("Sample description for a local UI check.");
    await expect
      .poll(async () => (await saved())?.title)
      .toBe("Sample report before discard");
    const originalId = (await saved())!.id;

    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 420;
      canvas.height = 180;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f0f1f5";
      ctx.fillRect(0, 0, 420, 180);
      ctx.fillStyle = "#242532";
      ctx.font = "24px sans-serif";
      ctx.fillText("Sample report screenshot", 24, 70);
      ctx.font = "18px sans-serif";
      ctx.fillText("Example text to redact", 24, 120);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await report.locator('input[type="file"]').setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    const editor = page.getByRole("dialog", { name: "Draw on sample" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await expect(report.locator(".report-shot img")).toBeVisible();
    const originalShot = (await saved())!.screenshots[0].id;
    await report
      .getByRole("button", { name: "Edit sample", exact: true })
      .click();
    await expect(editor).toBeVisible();
    await editor
      .getByRole("button", { name: "Black out", exact: true })
      .click();
    const layer = editor.getByLabel("Drawing layer");
    const box = (await layer.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65, {
      steps: 8,
    });
    await page.mouse.up();
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(async () => (await saved())?.screenshots[0]?.id)
      .not.toBe(originalShot);
    await report
      .locator(".report-footer")
      .getByRole("button", { name: "Preview", exact: true })
      .click();
    await expect(report.locator(".report-preview-shot")).toBeVisible();
    await expect
      .poll(async () => {
        const thumb = await report
          .locator(".report-shot img")
          .getAttribute("src");
        return (
          thumb ===
          (await report.locator(".report-preview-shot").getAttribute("src"))
        );
      })
      .toBe(true);
    await screenshot(page, { path: join(root, "report-edited-preview.png") });
    await report
      .getByRole("button", { name: "Remove sample", exact: true })
      .click();
    await expect(report.locator(".report-shot")).toHaveCount(0);
    await expect(report.locator(".report-preview-shot")).toHaveCount(0);

    await report
      .locator(".report-footer")
      .getByRole("button", { name: "Discard", exact: true })
      .click();
    await report
      .locator(".report-confirm")
      .getByRole("button", { name: "Discard", exact: true })
      .click();
    await expect(title).toHaveValue("");
    await title.fill("Replacement draft first edit");
    await report.locator("textarea").fill("The new draft keeps saving.");
    await expect
      .poll(async () => (await saved())?.title)
      .toBe("Replacement draft first edit");
    expect((await saved())!.id).not.toBe(originalId);
    expect((await saved())!.screenshots).toEqual([]);
    await settings.getByRole("button", { name: "Back to app" }).click();
    await openSettings();
    await settings
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Report a problem" })
      .click();
    await expect(title).toHaveValue("Replacement draft first edit");
    await expect(report.locator("textarea")).toHaveValue(
      "The new draft keeps saving.",
    );
    await screenshot(page, { path: join(root, "report-replacement.png") });
    console.log(`Report UI screenshots: ${root}`);
  } finally {
    await app.close();
  }
});
