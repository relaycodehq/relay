import { useWindowFocused } from "./window-focus";

/**
 * How much slower polls run while Relay isn't the frontmost window: what it
 * shows still moves for a glance from the editor, without asking every few
 * seconds for hours behind it.
 */
const BACKGROUND_SLOWDOWN = 4;

type Interval = number | false | undefined;

/**
 * A query's `refetchInterval` paced to the window's focus: as given while
 * Relay is in front, four times longer behind another window.
 */
export function usePoll() {
  const focused = useWindowFocused();
  return (ms: Interval): Interval =>
    ms && !focused ? ms * BACKGROUND_SLOWDOWN : ms;
}
