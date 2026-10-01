import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Snooze → Pick a time… snoozes a card until a day and time picked on the
// calendar and drum, without the picker's clicks opening the card.
test("snoozes a thread until a picked time", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-snooze-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const start = Date.now() - 86_400_000;
  const chat = (title: string, at: number) => ({
    id: randomUUID(),
    projectId,
    title,
    scope: { kind: "project" },
    created: at,
    updated: at + 1000,
    messages: [
      {
        id: `${title}-0`,
        role: "user",
        provider: "claude",
        status: "complete",
        body: "hello",
        created: at,
        version: 1,
      },
    ],
  });
  const chats = [chat("Later", start), chat("Other", start + 5000)];
  for (const c of chats)
    await writeFile(
      join(data, "project-chats", c.id + ".json"),
      JSON.stringify(c),
    );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      projects: [
        {
          id: projectId,
          path: repo,
          name: "project",
          repository: null,
          added: 1,
        },
      ],
      chats: chats.map((c) => ({ ...c, messages: undefined })),
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    const other = page.locator(".sb-card", { hasText: "Other" });
    const later = page.locator(".sb-card", { hasText: "Later" });
    await other.click();
    await expect(other).toHaveClass(/selected/);

    await later.hover();
    await later.getByRole("button", { name: "Snooze" }).click();
    await page.getByRole("button", { name: "Pick a time…" }).click();
    const picker = page.getByRole("dialog", { name: "Snooze" });
    const drum = picker.getByRole("listbox", { name: "Time" });
    const picked = drum.getByRole("option", { selected: true });
    const label = (at: number) =>
      page.evaluate(
        (at) =>
          new Date(at).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          }),
        at,
      );
    const at = (h: number, m: number) => {
      const wake = new Date();
      wake.setDate(wake.getDate() + 2);
      wake.setHours(h, m, 0, 0);
      return wake.getTime();
    };

    // The day takes the keyboard first: two days on, then the drum to 14:30.
    await expect(
      picker.getByRole("grid", { name: "Day" }).locator("[aria-selected=true]"),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Tab");
    await expect(drum).toBeFocused();
    await page.keyboard.press("Home");
    await expect(picked).toHaveText(await label(at(0, 0)));
    for (let i = 0; i < 7; i++) await page.keyboard.press("PageDown");
    await page.keyboard.press("ArrowDown");
    await expect(picked).toHaveText(await label(at(14, 30)));
    // Each wheel event of a notch's size turns exactly one half-hour.
    await drum.hover();
    await page.mouse.wheel(0, 200);
    await expect(picked).toHaveText(await label(at(15, 0)));
    await page.mouse.wheel(0, -200);
    await expect(picked).toHaveText(await label(at(14, 30)));
    await expect(picker).toContainText(await label(at(14, 30)));
    await picker.getByRole("button", { name: "Snooze", exact: true }).click();

    await expect(picker).toHaveCount(0);
    await expect(later).toHaveCount(0);
    // The picker's clicks didn't reach the card and open its thread.
    await expect(other).toHaveClass(/selected/);
    const shelf = page.locator(".sb-shelf-toggle", { hasText: "Snoozed" });
    if ((await shelf.getAttribute("aria-expanded")) !== "true")
      await shelf.click();
    await expect(
      page.locator(".sb-compact", { hasText: "Later" }),
    ).toContainText(await label(at(14, 30)));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
