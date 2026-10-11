// Replays the observed bugs without modifying app data or product source.
// Uses the existing Vite server. Assertions describe the observed broken state.
import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const base =
  process.env.RELAY_AUDIT_URL ||
  "http://127.0.0.1:5177/previews/polish-audit-d63c/";
const asset = (name) =>
  fileURLToPath(new URL(`assets/${name}`, import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 850 },
  timezoneId: "Europe/Prague",
});
page.setDefaultTimeout(8000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const results = {};
const open = (name) => page.goto(`${base}?case=${name}`);
const capture = (name) =>
  page
    .locator(".audit-lab>section")
    .screenshot({ path: asset(name), animations: "disabled" });
try {
  await open("notes");
  await page.getByRole("button", { name: "1 note", exact: true }).click();
  await page
    .locator(".notes-card")
    .screenshot({ path: asset("notes-before.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Remove this item" }).nth(1).click();
  await page
    .locator(".notes-card")
    .screenshot({ path: asset("notes-after.png"), animations: "disabled" });
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await page
    .getByRole("button", { name: "Quote it in your message", exact: true })
    .click();
  results.B1 = {
    quoted: await page.getByLabel("Quoted into the draft").inputValue(),
  };
  assert.equal(results.B1.quoted, "1. Already shipped");

  await open("queue");
  const measure = () =>
    page
      .locator(".queued-bubble")
      .evaluate((el) => ({
        class: el.className,
        width: el.clientWidth,
        visible: el.querySelector("p").clientHeight,
        content: el.querySelector("p").scrollHeight,
      }));
  const wide = await measure();
  assert.equal(wide.visible, wide.content);
  await page.getByRole("button", { name: "Narrow pane" }).click();
  await page.locator(".queued-bubble").click();
  const narrow = await measure();
  assert(narrow.content > narrow.visible);
  assert.equal(narrow.class, "queued-bubble");
  results.B2 = { wide, narrow };
  await capture("queue-clipped.png");

  await open("time&clock=dst");
  await page.getByRole("listbox", { name: "Time", exact: true }).focus();
  const times = [];
  for (let i = 0; i < 7; i++) {
    times.push(
      await page
        .getByRole("listbox", { name: "Time" })
        .locator("[aria-selected=true]")
        .innerText(),
    );
    await page.keyboard.press("ArrowDown");
  }
  assert.deepEqual(times, [
    "1:30 AM",
    "3:00 AM",
    "3:30 AM",
    "3:00 AM",
    "3:30 AM",
    "3:00 AM",
    "3:30 AM",
  ]);
  results.B3 = { timezone: "Europe/Prague", times };
  await capture("calendar-dst.png");

  await open("time&clock=month-end");
  results.B4 = {
    month: await page.locator(".pick-time-month").innerText(),
    selected: await page.locator(".pick-time-day[aria-selected=true]").count(),
  };
  assert.equal(results.B4.month, "October 2026");
  assert.equal(results.B4.selected, 0);
  await capture("calendar-month-end.png");

  await open("picker");
  await page.getByRole("button", { name: "Audit branch", exact: true }).click();
  const before = await page.locator(".search-select-popup").boundingBox();
  await page.screenshot({
    path: asset("picker-many.png"),
    animations: "disabled",
  });
  await page.getByRole("combobox").fill("main");
  // Screenshot waits for the new layout before measuring the positioner.
  await page.screenshot({
    path: asset("picker-one.png"),
    animations: "disabled",
  });
  const after = await page.locator(".search-select-popup").boundingBox();
  results.U1 = { before, after, moved: after.y - before.y };
  assert(results.U1.moved > 200);

  await page.setViewportSize({ width: 850, height: 850 });
  await open("queue");
  await page.getByRole("button", { name: "Reset wide" }).focus();
  const focus = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    focus.push(
      await page.evaluate(
        () =>
          document.activeElement.getAttribute("aria-label") ||
          document.activeElement.tagName,
      ),
    );
  }
  results.U2 = {
    focus,
    bubble: await page
      .locator(".queued-bubble")
      .evaluate((el) => ({
        class: el.className,
        tabIndex: el.tabIndex,
        role: el.getAttribute("role"),
      })),
  };
  assert.deepEqual(focus, [
    "Steer now",
    "Cancel and return to the composer",
    "BODY",
  ]);
  assert.equal(results.U2.bubble.tabIndex, -1);

  await page.setViewportSize({ width: 1280, height: 850 });
  await open("branches");
  await capture("long-branch.png");
  await page.goto(base);
  await page.screenshot({
    path: asset("report-overview.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Bug", exact: true }).click();
  assert.equal(await page.locator(".audit-finding").count(), 4);
  await page.getByRole("button", { name: "UI polish", exact: true }).click();
  assert.equal(await page.locator(".audit-finding").count(), 3);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.screenshot({
    path: asset("report-light.png"),
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  await writeFile(
    asset("reproduction-results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        status: "Observed bugs reproduced; report controls checked",
        results,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
