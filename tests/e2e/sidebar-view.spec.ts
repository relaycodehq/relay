import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SidebarView } from "../../shared/types";
import { screenshot } from "../fixtures/screenshot";

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
  ),
) as Record<string, string>;

const launch = (data: string) =>
  electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });

const savedView = async (data: string): Promise<SidebarView | undefined> => {
  try {
    return JSON.parse(await readFile(join(data, "state.json"), "utf8"))
      .sidebarView;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

test("sidebar choice survives reloads, browser storage loss and app restarts", async () => {
  const data = await mkdtemp(join(tmpdir(), "relay-sidebar-view-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    let page = await app.firstWindow();
    let toggle = page.getByRole("button", {
      name: "View activity",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => savedView(data)).toBe("activity");

    // An update can change the renderer's storage; app data must be enough.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".sb-activity")).toBeVisible();
    await screenshot(page, {
      path: "test-results/screenshots/sidebar-view-activity.png",
    });

    // Old browser state must not override the newer app preference.
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "threads"),
    );
    await app.close();
    app = await launch(data);
    page = await app.firstWindow();
    toggle = page.getByRole("button", { name: "View activity", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("ControlOrMeta+Alt+U");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => savedView(data)).toBe("threads");
    await page.evaluate(() => localStorage.clear());
    await app.close();
    app = await launch(data);
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "View activity", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page
        .locator(".sb")
        .getByRole("heading", { name: "Projects", exact: true }),
    ).toBeVisible();
    await screenshot(page, {
      path: "test-results/screenshots/sidebar-view-projects.png",
    });

    await expect(
      page.evaluate(() =>
        window.relay.saveSidebarView("invalid" as SidebarView),
      ),
    ).rejects.toThrow();
    expect(await savedView(data)).toBe("threads");
  } finally {
    await app?.close();
    await rm(data, { recursive: true, force: true });
  }
});

for (const view of ["activity", "threads"] as const) {
  test(`migrates the existing ${view} choice into app data`, async () => {
    const data = await mkdtemp(join(tmpdir(), "relay-sidebar-migrate-"));
    let app: ElectronApplication | undefined;
    try {
      app = await launch(data);
      let page = await app.firstWindow();
      await expect.poll(() => savedView(data)).toBe("threads");
      await page.evaluate(
        (view) => localStorage.setItem("relay-sidebar-view", view),
        view,
      );
      await app.close();
      app = undefined;

      // Reproduce the saved state from before app data held this preference.
      const statePath = join(data, "state.json");
      const state = JSON.parse(await readFile(statePath, "utf8"));
      delete state.sidebarView;
      await writeFile(statePath, JSON.stringify(state));

      app = await launch(data);
      page = await app.firstWindow();
      await expect(
        page.getByRole("button", { name: "View activity", exact: true }),
      ).toHaveAttribute("aria-pressed", String(view === "activity"));
      await expect.poll(() => savedView(data)).toBe(view);
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("relay-sidebar-view")),
        )
        .toBeNull();
    } finally {
      await app?.close();
      await rm(data, { recursive: true, force: true });
    }
  });
}
