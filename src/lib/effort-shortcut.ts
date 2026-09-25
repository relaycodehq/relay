import type { KeyboardEvent } from "react";
import type { ReasoningEffort } from "../../shared/settings";

/**
 * ⌘⌥←/→ (Ctrl+Alt elsewhere) steps effort. Plain, ⌥, ⌘ and ⇧ arrows all
 * move the caret or selection in the draft, so those stay untouched.
 */
export function effortStep(e: KeyboardEvent): -1 | 1 | 0 {
  if (e.nativeEvent.isComposing || e.shiftKey || !e.altKey) return 0;
  const mac = navigator.platform.startsWith("Mac");
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return 0;
  return e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
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

export const effortKeysLabel = navigator.platform.startsWith("Mac")
  ? "⌘⌥ ←→"
  : "Ctrl Alt ←→";
