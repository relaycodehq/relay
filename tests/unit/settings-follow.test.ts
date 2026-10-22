import { expect, it } from "vitest";
import { defaultPrefs } from "../../electron/settings/app-prefs";
import { mainSettings } from "../../src/features/settings/follow-main-settings";

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

it("refreshes every main-process preference in Settings when settings.json changes", () => {
  // A missing one shows its old value until Settings is reopened.
  expect(mainSettings.map(([key]) => key).sort()).toEqual(
    Object.keys(defaultPrefs).map(kebab).sort(),
  );
});
