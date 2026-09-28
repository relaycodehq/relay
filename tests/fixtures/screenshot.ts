import type {
  Locator,
  LocatorScreenshotOptions,
  Page,
  PageScreenshotOptions,
} from "@playwright/test";

/**
 * Whether this run keeps screenshots. They're for a person to look at after a
 * local run; nothing asserts on them. CI throws a passing run's away and draws
 * in software, where each one is slow, so it skips them.
 */
export const keepScreenshots = !process.env.CI;

/** Saves a screenshot to look at by hand, unless this run skips them. */
export async function screenshot(
  target: Page,
  options: PageScreenshotOptions,
): Promise<void>;
export async function screenshot(
  target: Locator,
  options: LocatorScreenshotOptions,
): Promise<void>;
export async function screenshot(
  target: Page | Locator,
  options: PageScreenshotOptions,
) {
  if (keepScreenshots) await (target as Page).screenshot(options);
}
