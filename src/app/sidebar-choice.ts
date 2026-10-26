/**
 * Whether the user hid the projects sidebar, kept for the chat alone and for
 * beside a side pane. `besidePane` is null until chosen there, which leaves it
 * to the "make room" setting.
 */
export type SidebarChoice = { alone: boolean; besidePane: boolean | null };

/**
 * What a hide or show by the user leaves. Either holds wherever the user goes
 * next, or switching to a thread with other panes open would undo it. Shown
 * with the chat alone, a side pane still makes room if the setting says so.
 */
export function sidebarChoiceAfter(
  hide: boolean,
  besidePane: boolean,
): SidebarChoice {
  if (hide) return { alone: true, besidePane: true };
  return { alone: false, besidePane: besidePane ? false : null };
}

/** Whether the user's choice hides the sidebar where it stands now. */
export function chosenHidden(
  choice: SidebarChoice,
  besidePane: boolean,
  autoHide: boolean,
) {
  if (!besidePane) return choice.alone;
  return choice.besidePane ?? (autoHide || choice.alone);
}
