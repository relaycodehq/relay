import { useDoubleEscape } from "./useDoubleEscape";
import {
  pressedTwice,
  useShortcut,
  useShortcutLabel,
  useShortcutValue,
} from "../../lib/shortcuts";

/**
 * Stop's keys while an answer runs: none unless someone set them, so a stray
 * Escape only closes things. 2× Esc, when chosen, counts in the composer and
 * is `armed` once the first Escape is in.
 */
export function useStopKeys(running: boolean, onStop: () => void) {
  const keys = useShortcutLabel("stop");
  const twice = useShortcutValue(() => pressedTwice("stop"));
  const armed = useDoubleEscape(running && twice, ".project-composer", onStop);
  useShortcut("stop", running, onStop);
  return { keys, armed };
}
