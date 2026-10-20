import {
  test as base,
  _electron as nativeElectron,
  type ElectronApplication,
} from "@playwright/test";
import { providerEnv } from "./provider-env";

export * from "@playwright/test";

let activeApps: Set<ElectronApplication> | undefined;

/** Each worker runs one test at a time. Apps opened in beforeAll stay caller-owned. */
export const test = base.extend<{ relayAppCleanup: void }>({
  relayAppCleanup: [
    async ({}, use) => {
      const apps = new Set<ElectronApplication>();
      activeApps = apps;
      try {
        await use();
      } finally {
        activeApps = undefined;
        const results = await Promise.allSettled(
          [...apps].map((app) => app.close()),
        );
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length)
          throw new AggregateError(errors, "Could not close Relay test apps");
      }
    },
    { auto: true },
  ],
});

/** Electron must launch as an app even when the test runner itself runs under Electron. */
export function relayEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
    ),
  );
}

export const _electron: typeof nativeElectron = {
  launch: async (options = {}) => {
    const env = relayEnv(options.env);
    const app = await nativeElectron.launch({
      args: ["tests/fixtures/launch.cjs"],
      ...options,
      env: {
        RELAY_TEST_HEADED: "0",
        RELAY_TEST_NATIVE_STORAGE: "0",
        ...(env.RELAY_TEST_DATA ? providerEnv(env) : env),
      },
    });
    const owner = activeApps;
    owner?.add(app);
    app.once("close", () => owner?.delete(app));
    return app;
  },
};
