import type { KeyboardEvent } from "react";
import type { ReasoningEffort } from "../../shared/settings";
import {
  bindings,
  comboLabel,
  matches,
  modifiersLabel,
  useShortcutValue,
} from "./shortcuts";

/**
 * ⌘⌥←/→ (Ctrl+Alt elsewhere) by default steps effort. Plain, ⌥, ⌘ and ⇧
 * arrows all move the caret or selection in the draft, so those stay untouched.
 */
export function effortStep(e: KeyboardEvent): -1 | 1 | 0 {
  if (e.nativeEvent.isComposing) return 0;
  return matches("effort-down", e) ? -1 : matches("effort-up", e) ? 1 : 0;
}

/**
 * The level one step from `current`. Default steps from the level it runs,
 * and the ends don't wrap, so holding the key settles on min or max.
 */
export function stepEffort(
  efforts: ReasoningEffort[],
  current: ReasoningEffort,
  defaultLevel: ReasoningEffort,
  step: -1 | 1,
): ReasoningEffort {
  if (!efforts.length) return current;
  let at = efforts.indexOf(current || defaultLevel);
  if (at < 0) at = efforts.indexOf("medium");
  if (at < 0) at = Math.floor(efforts.length / 2);
  return efforts[Math.min(efforts.length - 1, Math.max(0, at + step))];
}

/** "⌥⌘ ←→" while both keys share modifiers and arrows, else both in full. */
export function effortKeysLabel() {
  const [down] = bindings("effort-down");
  const [up] = bindings("effort-up");
  if (
    down?.code === "ArrowLeft" &&
    up?.code === "ArrowRight" &&
    modifiersLabel(down) === modifiersLabel(up)
  )
    return `${modifiersLabel(down)} ←→`;
  return [down, up]
    .filter((c) => !!c)
    .map((c) => comboLabel(c))
    .join(" / ");
}

export const useEffortKeysLabel = () => useShortcutValue(effortKeysLabel);
