import { openSignIn, openInbox } from "../fixtures/navigation";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureServer } from "../fixtures/gitea";

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
  ),
) as Record<string, string>;

test("default test windows remain hidden and unfocused while UI actions and activation events work", async () => {
  test.skip(process.env.RELAY_TEST_HEADED === "1", "Background runner check");
  const data = await mkdtemp(join(tmpdir(), "relay-background-"));
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    await openSignIn(page);
    await page
      .getByLabel("Gitea server", { exact: true })
      .fill("https://background.test");
    await app.evaluate(({ app }) => {
      app.emit("activate");
      app.emit("second-instance", {}, [], "");
    });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          visible: relaySeen(w),
          focused: w.isFocused(),
        })),
      ),
    ).toEqual([{ visible: false, focused: false }]);
    await expect(page.getByLabel("Gitea server", { exact: true })).toHaveValue(
      "https://background.test",
    );
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("activation and second launch restore hidden/minimized windows without replacing their contents", async () => {
  test.skip(
    process.env.RELAY_TEST_HEADED !== "1",
    "Native focus test requires explicit RELAY_TEST_HEADED=1; it can interrupt the desktop.",
  );
  const data = await mkdtemp(join(tmpdir(), "relay-window-"));
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    await openSignIn(page);
    await page
      .getByLabel("Gitea server", { exact: true })
      .fill("https://git.example.com/keep-this-input");
    const id = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
    );
    for (const event of ["activate", "second-instance"] as const) {
      await app.evaluate(({ app, BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].hide();
        if (process.platform === "darwin") app.hide();
      });
      await expect
        .poll(() =>
          app.evaluate(({ app, BrowserWindow }) => ({
            visible: BrowserWindow.getAllWindows()[0].isVisible(),
            hidden: process.platform === "darwin" && app.isHidden(),
          })),
        )
        .toEqual({ visible: false, hidden: process.platform === "darwin" });
      await app.evaluate(({ app }, event) => {
        app.emit(event, {}, [], "");
      }, event);
      await expect
        .poll(() =>
          app.evaluate(({ app, BrowserWindow }) => ({
            visible: BrowserWindow.getAllWindows()[0].isVisible(),
            hidden: process.platform === "darwin" && app.isHidden(),
          })),
        )
        .toEqual({ visible: true, hidden: false });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].minimize(),
      );
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isMinimized(),
          ),
        )
        .toBe(true);
      await app.evaluate(({ app }, event) => {
        app.emit(event, {}, [], "");
      }, event);
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isMinimized(),
          ),
        )
        .toBe(false);
      await expect(
        page.getByLabel("Gitea server", { exact: true }),
      ).toHaveValue("https://git.example.com/keep-this-input");
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.id),
        ),
      ).toEqual([id]);
    }
    if (process.platform === "darwin") {
      await page.close();
      await app.evaluate(({ app }) => {
        app.emit("activate");
      });
      const reopened = await app.firstWindow();
      await expect(
        reopened.getByRole("button", { name: "Connect to Gitea", exact: true }),
      ).toBeVisible();
    }
  } finally {
    await app.close();
  }
});

for (const cancel of [false, true]) {
  test(`Keychain wait keeps the window responsive; ${cancel ? "cancel ignores late unlock" : "denial can be retried without losing the review"}`, async () => {
    const fixture = await fixtureServer();
    const data = await mkdtemp(join(tmpdir(), "relay-unlock-"));
    const account = {
      id: "fixture-account",
      server: fixture.serverUrl,
      user: {
        id: 42,
        login: "reviewer",
        full_name: "Test Reviewer",
        avatar_url: "",
      },
      persistent: true,
    };
    const saved = {
      version: 1,
      account,
      encryptedToken: Buffer.from("fixture-ciphertext").toString("base64"),
      folders: {},
      progress: {},
      workspaces: {
        [account.id]: {
          pull: { owner: "Web", name: "web-store", number: 7 },
          file: "src/hooks/useReview.ts",
          filter: "created",
          query: "",
          state: "open",
        },
      },
    };
    await writeFile(join(data, "state.json"), JSON.stringify(saved));
    const app = await electron.launch({
      args: ["tests/fixtures/locked-login.cjs"],
      env: { ...env, RELAY_TEST_DATA: data },
    });
    try {
      const page = await app.firstWindow();
      await openSignIn(page);
      await expect(
        page.getByRole("heading", { name: "Unlocking your saved sign-in." }),
      ).toBeVisible();
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            relaySeen(BrowserWindow.getAllWindows()[0]),
          ),
        )
        .toBe(process.env.RELAY_TEST_HEADED === "1");
      // IPC remains available even while the OS credential request is unresolved.
      expect(
        (await page.evaluate(() => window.relay.bootstrap())).loginRestore,
      ).toBe("unlocking");
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.screenshot({
          path: `test-results/screenshots/unlocking-${theme}.png`,
        });
      }
      if (cancel) {
        await page
          .getByRole("button", { name: "Sign in again", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Connect to Gitea", exact: true }),
        ).toBeVisible();
        await app.evaluate(() => {
          (globalThis as any).finishUnlock(true);
        });
        expect(
          (await page.evaluate(() => window.relay.bootstrap())).account,
        ).toBeNull();
        await expect(
          page.getByLabel("Gitea server", { exact: true }),
        ).toHaveValue(fixture.serverUrl);
        expect(
          JSON.parse(await readFile(join(data, "state.json"), "utf8")),
        ).toEqual(saved);
      } else {
        await app.evaluate(() => {
          (globalThis as any).finishUnlock(false);
        });
        await expect(page.getByRole("alert")).toContainText(
          "Your saved sign-in could not be unlocked",
        );
        expect(
          JSON.parse(await readFile(join(data, "state.json"), "utf8")),
        ).toEqual(saved);
        await page
          .getByRole("button", { name: "Try again", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Unlocking your saved sign-in." }),
        ).toBeVisible();
        await app.evaluate(() => {
          (globalThis as any).finishUnlock(true);
        });
        await expect
          .poll(
            async () =>
              (await page.evaluate(() => window.relay.bootstrap())).account?.id,
          )
          .toBe(account.id);
        await openInbox(page);
        await expect(
          page.getByRole("combobox", { name: "Current file" }),
        ).toHaveValue("src/hooks/useReview.ts");
        await expect(page.locator("diffs-container")).toBeVisible();
        expect(
          (await page.evaluate(() => window.relay.bootstrap())).account?.id,
        ).toBe(account.id);
      }
    } finally {
      await app.close();
      await fixture.close();
    }
  });
}

test("asynchronous credential storage reads existing encrypted logins and round-trips new logins", async () => {
  test.skip(
    process.env.RELAY_TEST_NATIVE_STORAGE !== "1",
    "Real Keychain integration requires explicit RELAY_TEST_NATIVE_STORAGE=1; it may show an OS prompt.",
  );
  const data = await mkdtemp(join(tmpdir(), "relay-crypto-"));
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: { ...env, RELAY_TEST_DATA: data },
  });
  try {
    await app.firstWindow();
    const result = await app.evaluate(async ({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const old = safeStorage.encryptString("synthetic-test-credential");
      const restored = await safeStorage.decryptStringAsync(old);
      const fresh = await safeStorage.encryptStringAsync(
        "synthetic-test-credential",
      );
      return {
        oldReadable: restored.result === "synthetic-test-credential",
        newReadable:
          (await safeStorage.decryptStringAsync(fresh)).result ===
          "synthetic-test-credential",
        encrypted: !fresh.includes(Buffer.from("synthetic-test-credential")),
      };
    });
    test.skip(result === null, "System credential storage unavailable");
    expect(result).toEqual({
      oldReadable: true,
      newReadable: true,
      encrypted: true,
    });
  } finally {
    await app.close();
  }
});
