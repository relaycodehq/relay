// Run with the preview's Vite server already running; evidence goes in test-results.
// RELAY_POLISH_URL=http://127.0.0.1:5587/previews/polish-fixes/ node previews/polish-fixes/verify.mjs
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base =
  process.env.RELAY_POLISH_URL ||
  "http://127.0.0.1:5177/previews/polish-fixes/";
const output = "test-results/polish-fixes";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 850 },
  timezoneId: "Europe/Prague",
  locale: "en-US",
});
page.setDefaultTimeout(8000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const results = {};
const open = (name) => page.goto(`${base}?case=${name}`);
const capture = (name, locator = page.locator(".audit-lab>section")) =>
  locator.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
try {
  await open("notes");
  await page.getByRole("button", { name: "1 note", exact: true }).click();
  await page.getByRole("button", { name: "Remove this item" }).nth(1).click();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "All done — uncheck an item to quote it",
      exact: true,
    }),
  ).toBeDisabled();
  await capture("notes-completed", page.locator(".notes-card"));
  await page.getByRole("checkbox").uncheck();
  await page
    .getByRole("button", { name: "Quote it in your message", exact: true })
    .click();
  await expect(page.getByLabel("Quoted into the draft")).toHaveValue(
    "1. Already shipped",
  );
  results.notes = "Completion preserved; quoting resumes only after unchecking";

  await open("queue");
  const more = page.getByRole("button", { name: "Show more", exact: true });
  const less = page.getByRole("button", { name: "Show less", exact: true });
  await expect(more).toHaveCount(0);
  await page.getByRole("button", { name: "Narrow pane" }).click();
  await expect(more).toBeVisible();
  await page.getByRole("button", { name: "Reset wide" }).focus();
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(less).toHaveAttribute("aria-expanded", "true");
  const p = page.locator(".queued-bubble > p");
  expect(await p.evaluate((el) => el.clientHeight === el.scrollHeight)).toBe(
    true,
  );
  await capture("queue-expanded");
  await page.keyboard.press("Space");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await capture("queue-folded");
  await page.getByRole("button", { name: "Widen pane" }).click();
  await expect(more).toHaveCount(0);
  results.queue =
    "Remeasured on both resizes; keyboard Enter and Space toggle the full text";

  await open("time&clock=dst");
  const drum = page.getByRole("listbox", { name: "Time", exact: true });
  const selected = drum.getByRole("option", { selected: true });
  await drum.focus();
  const times = [];
  for (let i = 0; i < 7; i++) {
    times.push(await selected.innerText());
    await page.keyboard.press("ArrowDown");
  }
  expect(times).toEqual([
    "1:30 AM",
    "3:00 AM",
    "3:30 AM",
    "4:00 AM",
    "4:30 AM",
    "5:00 AM",
    "5:30 AM",
  ]);
  await page.keyboard.press("End");
  await expect(selected).toHaveText("11:30 PM");
  await page.keyboard.press("Home");
  await expect(selected).toHaveText("12:30 AM");
  await page.keyboard.press("PageDown");
  await expect(selected).toHaveText("3:30 AM");
  await capture("calendar-spring");
  results.spring = times;

  await open("time&clock=fall");
  await drum.focus();
  const fall = [];
  for (let i = 0; i < 7; i++) {
    fall.push(await selected.getAttribute("aria-label"));
    await page.keyboard.press("ArrowDown");
  }
  expect(fall).toEqual([
    "1:30 AM",
    "2:00 AM GMT+2",
    "2:30 AM GMT+2",
    "2:00 AM GMT+1",
    "2:30 AM GMT+1",
    "3:00 AM",
    "3:30 AM",
  ]);
  await page.keyboard.press("Home");
  await page.keyboard.press("PageDown");
  await capture("calendar-fall");
  results.fall = fall;

  await open("time&clock=month-end");
  await expect(page.locator(".pick-time-month")).toHaveText("November 2026");
  const day = page.locator(".pick-time-day[aria-selected=true]");
  await expect(day).toHaveCount(1);
  await expect(day).toBeFocused();
  await expect(day).toHaveText("1");
  await page.keyboard.press("ArrowLeft");
  // Clamping to the earliest future slot keeps October 31 visible and focused.
  await expect(day).toBeFocused();
  await expect(day).toHaveText("31");
  await expect(page.locator(".pick-time-month")).toHaveText("October 2026");
  await page.keyboard.press("ArrowRight");
  await capture("calendar-month-end");
  results.monthEnd =
    "November opens selected and focused; crossing the month keeps both in sync";

  await open("picker");
  await page.getByRole("button", { name: "Audit branch", exact: true }).click();
  const popup = page.locator(".search-select-popup");
  await expect(page.getByRole("option")).toHaveCount(24);
  const bounds = await popup.boundingBox();
  await capture("picker-many", popup);
  // The initially mounted first row must be registered for keyboard selection.
  await page.getByRole("combobox").fill("main");
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await page.getByRole("button", { name: "Audit branch", exact: true }).click();
  for (const query of ["main", "no-such-branch", ""]) {
    await page.getByRole("combobox").fill(query);
    await expect.poll(() => popup.boundingBox()).toEqual(bounds);
  }
  await page.getByRole("combobox").fill("main");
  await capture("picker-filtered", popup);
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  // Filtering a later row moves it to index zero; Enter must still reach it.
  await page.getByRole("button", { name: "Audit branch", exact: true }).click();
  await page.getByRole("combobox").fill("branch-21");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Audit branch", exact: true }),
  ).toHaveText("feature/branch-21");
  results.picker = bounds;

  await page.setViewportSize({ width: 850, height: 430 });
  await open("picker");
  await page.getByRole("button", { name: "Audit branch", exact: true }).click();
  const short = await popup.boundingBox();
  expect(short.y).toBeGreaterThanOrEqual(11);
  expect(short.y + short.height).toBeLessThanOrEqual(419);
  await page.getByRole("combobox").fill("main");
  await expect.poll(() => popup.boundingBox()).toEqual(short);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 850 });
  await open("branches");
  const source = page.getByRole("button", {
    name: "Branch to review",
    exact: true,
  });
  const target = page.getByRole("button", { name: "Base branch", exact: true });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox.y).toBe(targetBox.y);
  expect(await source.getAttribute("title")).toBe(
    "relay/investigate-why-the-thread-preview-disappears-after-opening-another-window",
  );
  const row = page.locator(".deep-review-branches");
  expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await capture("branches-dark");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await capture("branches-light");
  results.branches =
    "Both branches and direction stay on one row; full name available in tooltip";
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
