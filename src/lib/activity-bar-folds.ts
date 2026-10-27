import { fileSetting } from "./settings-file";

/**
 * Whether the activity bar folds away with the projects sidebar, giving the
 * page the whole width. Off by default; kept in settings.json.
 */
const folds = fileSetting<boolean>({
  path: ["activityBar", "foldsWithSidebar"],
  parse: (saved) => saved === true,
  serialize: (on) => (on ? true : undefined),
});

export const useBarFoldsWithSidebar = folds.use;
export const setBarFoldsWithSidebar = folds.set;
