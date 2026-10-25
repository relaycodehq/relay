import { fileSetting } from "./settings-file";

/**
 * Whether Activity cards show the thread's branch or worktree under its
 * title. Kept in settings.json.
 */
const branches = fileSetting<boolean>({
  path: ["sidebar", "activityBranches"],
  parse: (saved) => saved !== false,
  serialize: (on) => (on ? undefined : false),
});

export const useActivityBranches = branches.use;
export const setActivityBranches = branches.set;
