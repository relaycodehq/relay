import { persistedStore } from "../../lib/persisted-store";

/** The composer's controls that can move or hide; Stop and Send stay last. */
export const toolbarItems = [
  "model",
  "account",
  "effort",
  "context",
  "access",
  "mode",
  "attach",
  "usage",
  "mic",
] as const;
export type ToolbarItem = (typeof toolbarItems)[number];
/** "gap" is the spacer: whatever follows it sits on the right. */
export type ToolbarSlot = ToolbarItem | "gap";

export interface ToolbarLayout {
  /** Every slot once, in order. */
  slots: ToolbarSlot[];
  hidden: ToolbarItem[];
}

export const defaultToolbar: ToolbarLayout = {
  slots: [
    "model",
    "account",
    "effort",
    "context",
    "access",
    "mode",
    "attach",
    "gap",
    "usage",
    "mic",
  ],
  // The model picker's footer switches accounts too; this is for those who want it in view.
  hidden: ["account"],
};

export const toolbarNames: Record<ToolbarItem, string> = {
  model: "Model",
  account: "Account",
  effort: "Effort",
  context: "Context meter",
  access: "Access",
  mode: "Mode",
  attach: "Attach",
  usage: "Usage limits",
  mic: "Dictation",
};

export const canHide = (item: ToolbarItem) => item !== "model";

/** Labelled controls get a divider between them; bare icon buttons don't. */
const divided = new Set<ToolbarSlot>([
  "model",
  "account",
  "effort",
  "context",
  "access",
  "mode",
  "usage",
]);

/**
 * The slots to draw, in order: shown items that `present` has a control for,
 * and the gap. `divider` marks a slot that follows a divider.
 */
export function toolbarRun(
  layout: ToolbarLayout,
  present: (item: ToolbarItem) => boolean,
) {
  const shown = layout.slots.filter(
    (slot) =>
      slot === "gap" || (!layout.hidden.includes(slot) && present(slot)),
  );
  return shown.map((slot, i) => ({
    slot,
    divider: i > 0 && divided.has(shown[i - 1]) && divided.has(slot),
  }));
}

/** Moves `slot` next to `target`, after it when `after`, and shows it. */
export function placeSlot(
  layout: ToolbarLayout,
  slot: ToolbarSlot,
  target: ToolbarSlot,
  after: boolean,
): ToolbarLayout {
  if (slot === target) return layout;
  const slots = layout.slots.filter((s) => s !== slot);
  slots.splice(slots.indexOf(target) + (after ? 1 : 0), 0, slot);
  const hidden = layout.hidden.filter((h) => h !== slot);
  // Dragging keeps asking; a move that changes nothing is the same layout.
  const same =
    hidden.length === layout.hidden.length &&
    slots.every((s, i) => s === layout.slots[i]);
  return same ? layout : { slots, hidden };
}

/** Moves `slot` one place along the shown slots. */
export function stepSlot(
  layout: ToolbarLayout,
  slot: ToolbarSlot,
  by: -1 | 1,
): ToolbarLayout {
  const shown = layout.slots.filter(
    (s) => s === "gap" || !layout.hidden.includes(s),
  );
  const target = shown[shown.indexOf(slot) + by];
  return target ? placeSlot(layout, slot, target, by > 0) : layout;
}

export function hideItem(
  layout: ToolbarLayout,
  item: ToolbarItem,
): ToolbarLayout {
  if (!canHide(item) || layout.hidden.includes(item)) return layout;
  return { ...layout, hidden: [...layout.hidden, item] };
}

export const showItem = (
  layout: ToolbarLayout,
  item: ToolbarItem,
): ToolbarLayout =>
  layout.hidden.includes(item)
    ? { ...layout, hidden: layout.hidden.filter((h) => h !== item) }
    : layout;

export const isDefaultToolbar = (layout: ToolbarLayout) =>
  [...layout.hidden].sort().join() ===
    [...defaultToolbar.hidden].sort().join() &&
  layout.slots.join() === defaultToolbar.slots.join();

const isSlot = (value: unknown): value is ToolbarSlot =>
  value === "gap" || (toolbarItems as readonly unknown[]).includes(value);

/**
 * A saved layout made whole: unknown slots dropped, and slots it lacks, like
 * a control added since, put back beside their default neighbour, hidden if
 * the default hides them.
 */
export function parseToolbar(saved: unknown): ToolbarLayout {
  const value = saved as Partial<Record<keyof ToolbarLayout, unknown>> | null;
  const listed = Array.isArray(value?.slots) ? value.slots : [];
  const slots = [...new Set(listed.filter(isSlot))];
  const added: ToolbarSlot[] = [];
  defaultToolbar.slots.forEach((slot, i) => {
    if (slots.includes(slot)) return;
    const before = defaultToolbar.slots[i - 1];
    slots.splice(before ? slots.indexOf(before) + 1 : 0, 0, slot);
    added.push(slot);
  });
  const hidden = [
    ...(Array.isArray(value?.hidden) ? value.hidden : []),
    ...added.filter((slot) =>
      (defaultToolbar.hidden as ToolbarSlot[]).includes(slot),
    ),
  ];
  return {
    slots,
    hidden: [...new Set(hidden.filter(isSlot))].filter(
      (slot): slot is ToolbarItem => slot !== "gap" && canHide(slot),
    ),
  };
}

// The usage ring had an on/off switch before it could be hidden here.
function usageWasOff() {
  try {
    return localStorage.getItem("relay-usage-ring") === "off";
  } catch {
    return false;
  }
}

const store = persistedStore<ToolbarLayout>(
  "relay-composer-toolbar",
  (saved) => {
    if (saved !== null) return parseToolbar(JSON.parse(saved));
    return usageWasOff()
      ? { ...defaultToolbar, hidden: [...defaultToolbar.hidden, "usage"] }
      : defaultToolbar;
  },
  (layout) => JSON.stringify(layout),
);
export const composerToolbar = store.get;
export const useComposerToolbar = store.use;
export const setComposerToolbar = store.set;
