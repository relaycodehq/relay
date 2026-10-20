import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the window can reload itself but cannot navigate elsewhere", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-reload-"));
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
    },
  });
  try {
    const page = await app.firstWindow();
    const start = page.url();
    // The error screen's button and Vite's full reload both do this.
    await page.evaluate(() => {
      (window as { marker?: number }).marker = 1;
    });
    await Promise.all([
      page.waitForEvent("load"),
      page.evaluate(() => location.reload()),
    ]);
    expect(
      await page.evaluate(() => (window as { marker?: number }).marker),
    ).toBeUndefined();

    await page.evaluate(() => {
      (window as { marker?: number }).marker = 2;
      location.href = "https://example.com/";
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(start);
    expect(
      await page.evaluate(() => (window as { marker?: number }).marker),
    ).toBe(2);
  } finally {
    await app.close();
  }
});
