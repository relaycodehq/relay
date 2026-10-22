import { localSwitch } from "./local-switch";

/** Whether Activity cards show the thread's branch or worktree under its title. */
const branches = localSwitch("relay-activity-branches");
export const useActivityBranches = branches.use;
export const setActivityBranches = branches.set;
