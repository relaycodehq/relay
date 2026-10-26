import {
  closeTab,
  dropTabs,
  emptyTabs,
  keepTab,
  moveTab,
  openTab,
  parseTabs,
  renameTabs,
  setPinned,
  tabId,
  type EditorTab,
  type TabState,
} from "./editor-tabs";

/** One split of the editor: its own tabs, the one in front, and their order of use. */
export type EditorGroup = TabState & { id: string };

/**
 * The editor's splits side by side (or one above another), each with its
 * tabs. Files open in the focused one.
 */
export type EditorLayout = {
  groups: EditorGroup[];
  focused: string;
  direction: "row" | "column";
};

/** Splits past this are more than a pane holds. */
export const MAX_GROUPS = 4;

let idsMade = 0;
const newId = () => `g${Date.now().toString(36)}${(idsMade++).toString(36)}`;

export const singleGroup = (tabs: TabState = emptyTabs): EditorLayout => {
  const id = newId();
  return { groups: [{ id, ...tabs }], focused: id, direction: "row" };
};

export const focusedGroup = (layout: EditorLayout) =>
  layout.groups.find((g) => g.id === layout.focused) ?? layout.groups[0];

const withGroup = (
  layout: EditorLayout,
  id: string,
  change: (group: EditorGroup) => TabState,
): EditorLayout => ({
  ...layout,
  groups: layout.groups.map((g) => (g.id === id ? { ...change(g), id } : g)),
});

/** Opens `tab` in a split (the focused one by default) and focuses that split. */
export function openIn(
  layout: EditorLayout,
  tab: EditorTab,
  keep?: (tab: EditorTab) => boolean,
  group = layout.focused,
): EditorLayout {
  return {
    ...withGroup(layout, group, (g) => openTab(g, tab, keep)),
    focused: group,
  };
}

/** Closes a tab in a split; a split left empty goes, unless it's the last. */
export function closeIn(
  layout: EditorLayout,
  group: string,
  id: string,
): EditorLayout {
  const next = withGroup(layout, group, (g) => closeTab(g, id));
  const closedIn = next.groups.find((g) => g.id === group);
  const keepsGroup =
    !closedIn || closedIn.tabs.length > 0 || next.groups.length === 1;
  return keepsGroup ? next : dropGroup(next, group);
}

function dropGroup(layout: EditorLayout, group: string): EditorLayout {
  const at = layout.groups.findIndex((g) => g.id === group);
  const groups = layout.groups.filter((g) => g.id !== group);
  const focused =
    layout.focused === group ? groups[Math.max(0, at - 1)].id : layout.focused;
  return { ...layout, groups, focused };
}

/** Pins or unpins a tab in a split. */
export const pinIn = (
  layout: EditorLayout,
  group: string,
  id: string,
  pinned: boolean,
) => withGroup(layout, group, (g) => setPinned(g, id, pinned));

/** A previewed tab in a split stays open when another file is looked at. */
export const keepIn = (layout: EditorLayout, group: string, id: string) =>
  withGroup(layout, group, (g) => keepTab(g, id));

/** Previewed tabs that were edited stay, as VS Code's do. */
export function keepEdited(
  layout: EditorLayout,
  edited: (tab: EditorTab) => boolean,
): EditorLayout {
  const editedPreview = (t: EditorTab) => !!t.preview && edited(t);
  // Every split's own copy: allTabs keeps one per file, which may not be the preview.
  if (!layout.groups.some((g) => g.tabs.some(editedPreview))) return layout;
  return {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...g,
      tabs: g.tabs.map((t) =>
        editedPreview(t) ? { ...t, preview: undefined } : t,
      ),
    })),
  };
}

/**
 * A new split beside `group` showing its tab in front (or the tab `id`), as
 * an IDE's Split Right does; the file stays where it was too, both showing
 * one document. The copy isn't pinned.
 */
export function split(
  layout: EditorLayout,
  group: string,
  direction: EditorLayout["direction"] = "row",
  shown?: string,
): EditorLayout {
  const from = layout.groups.find((g) => g.id === group);
  if (!from || layout.groups.length >= MAX_GROUPS) return layout;
  const tab = from.tabs.find((t) => tabId(t) === (shown ?? from.active));
  const id = newId();
  const fresh: EditorGroup = {
    id,
    ...(tab
      ? openTab(emptyTabs, { ...tab, pinned: undefined, preview: undefined })
      : emptyTabs),
  };
  const groups = [...layout.groups];
  groups.splice(groups.indexOf(from) + 1, 0, fresh);
  return {
    groups,
    focused: id,
    direction: layout.groups.length > 1 ? layout.direction : direction,
  };
}

/** Moves a tab into another split, as dragging it across does. */
export function moveToGroup(
  layout: EditorLayout,
  from: string,
  id: string,
  to: string,
  before: string | null = null,
): EditorLayout {
  if (from === to)
    return withGroup(layout, from, (g) => moveTab(g, id, before));
  const tab = layout.groups
    .find((g) => g.id === from)
    ?.tabs.find((t) => tabId(t) === id);
  if (!tab) return layout;
  // Dragged somewhere on purpose, a previewed tab stays.
  const moved = { ...tab, preview: undefined };
  let next = withGroup(layout, to, (g) => moveTab(openTab(g, moved), id, before));
  next = closeIn(next, from, id);
  return { ...next, focused: to };
}

export function focusGroup(layout: EditorLayout, group: string): EditorLayout {
  const exists = layout.groups.some((g) => g.id === group);
  if (!exists || layout.focused === group) return layout;
  return { ...layout, focused: group };
}

/** A file or folder moved: tabs on it or under it follow, in every split. */
export const renameInGroups = (
  layout: EditorLayout,
  from: string,
  to: string,
  outside = false,
) => ({
  ...layout,
  groups: layout.groups.map((g) => ({
    ...renameTabs(g, from, to, outside),
    id: g.id,
  })),
});

/** A file or folder went to the Trash: its tabs close everywhere, and splits left empty go. */
export function dropInGroups(
  layout: EditorLayout,
  path: string,
  outside = false,
): EditorLayout {
  let next: EditorLayout = {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...dropTabs(g, path, outside),
      id: g.id,
    })),
  };
  for (const group of next.groups)
    if (!group.tabs.length && next.groups.length > 1)
      next = dropGroup(next, group.id);
  return next;
}

/** Every tab open in any split, once each. */
export function allTabs(layout: EditorLayout) {
  const seen = new Map<string, EditorTab>();
  for (const group of layout.groups)
    for (const tab of group.tabs) seen.set(tabId(tab), tab);
  return [...seen.values()];
}

/** Paths of the focused split's project files, the one used last first. */
export function recentPaths(layout: EditorLayout) {
  const tabs = allTabs(layout);
  return focusedGroup(layout)
    .recent.map((id) => tabs.find((t) => tabId(t) === id))
    .filter((t): t is EditorTab => !!t && !t.outside)
    .map((t) => t.path);
}

function parseGroup(saved: unknown): EditorGroup | undefined {
  const tabs = parseTabs(JSON.stringify(saved));
  if (!tabs) return;
  const savedId = (saved as { id?: unknown }).id;
  return { id: typeof savedId === "string" ? savedId : newId(), ...tabs };
}

/** A saved layout, or one split from tabs saved before splits, or nothing usable. */
export function parseLayout(saved: string | null): EditorLayout | undefined {
  if (!saved) return;
  let value: Partial<EditorLayout>;
  try {
    value = JSON.parse(saved);
  } catch {
    return;
  }
  if (!Array.isArray(value.groups)) {
    const tabs = parseTabs(saved);
    return tabs && singleGroup(tabs);
  }
  const groups = value.groups
    .slice(0, MAX_GROUPS)
    .map(parseGroup)
    .filter((g): g is EditorGroup => !!g);
  if (!groups.length) return;
  const focusedSaved = groups.find((g) => g.id === value.focused);
  return {
    groups,
    focused: (focusedSaved ?? groups[0]).id,
    direction: value.direction === "column" ? "column" : "row",
  };
}
