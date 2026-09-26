import { localSwitch } from "./local-switch";

/**
 * Whether opening Changes, Files or History hides the projects sidebar to make
 * room, and brings it back once they close.
 */
const autoHide = localSwitch("relay-sidebar-auto-hide");
export const useSidebarAutoHide = autoHide.use;
export const setSidebarAutoHide = autoHide.set;
