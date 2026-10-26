/**
 * A file open in a tab: in the folder, or outside it by its absolute path.
 * A pinned tab stays at the start of its split and isn't closed to make room.
 * A `snapshot` tab shows a version of the file that isn't on disk, kept in
 * snapshots.ts under that id; it lasts only as long as the window.
 * A `preview` tab is a file only looked at, as VS Code's are: the next file
 * looked at takes its place, until it's edited or kept.
 */
export type EditorTab = {
  path: string;
  outside?: boolean;
  pinned?: true;
  snapshot?: string;
  preview?: true;
};

export type TabState = {
  tabs: EditorTab[];
  /** The tab in front, by id. */
  active: string | null;
  /** Ids, most recently in front first, for the recent files list. */
  recent: string[];
};

/** Past this many, opening another closes the unpinned, saved one longest out of sight. */
export const MAX_TABS = 20;

export function tabId(tab: EditorTab) {
  if (tab.snapshot) return "snapshot:" + tab.snapshot;
  return (tab.outside ? "outside:" : "") + tab.path;
}

export const emptyTabs: TabState = { tabs: [], active: null, recent: [] };

/** `path` is the folder itself, or something under it. */
export const isWithin = (path: string, folder: string) =>
  path === folder || path.startsWith(folder + "/");

/**
 * A file at or under `path`: a project file, or with `outside` one outside
 * the project by its absolute path. A snapshot is never on disk.
 */
export const tabIsWithin = (tab: EditorTab, path: string, outside = false) =>
  !!tab.outside === outside && !tab.snapshot && isWithin(tab.path, path);

/** Pinned tabs first; each side keeps its order. */
export const pinnedFirst = (tabs: EditorTab[]) => [
  ...tabs.filter((t) => t.pinned),
  ...tabs.filter((t) => !t.pinned),
];

const withFront = (recent: string[], id: string) => [
  id,
  ...recent.filter((r) => r !== id),
];

const kept = ({ preview: _, ...tab }: EditorTab): EditorTab => tab;

/** The tab `id` stays open when another file is looked at. */
export function keepTab(state: TabState, id: string): TabState {
  const tab = state.tabs.find((t) => tabId(t) === id);
  if (!tab?.preview) return state;
  return { ...state, tabs: state.tabs.map((t) => (t === tab ? kept(t) : t)) };
}

/**
 * Opens `tab` beside the one in front and brings it forward, or just brings
 * it forward when it's open. A preview takes the place of the split's last
 * one. `keep` says which tabs besides the pinned ones mustn't close to make
 * room or be replaced (unsaved ones).
 */
export function openTab(
  state: TabState,
  tab: EditorTab,
  keep: (tab: EditorTab) => boolean = () => false,
): TabState {
  const id = tabId(tab);
  const open = state.tabs.find((t) => tabId(t) === id);
  if (open) {
    // Opened for keeps, a file only looked at so far stays.
    const shown = tab.preview ? state : keepTab(state, id);
    return { ...shown, active: id, recent: withFront(state.recent, id) };
  }
  const replaced = tab.preview
    ? state.tabs.find((t) => t.preview && !keep(t))
    : undefined;
  if (replaced) return replaceTab(state, replaced, tab);
  const frontAt = state.tabs.findIndex((t) => tabId(t) === state.active);
  let tabs = [...state.tabs];
  tabs.splice(frontAt < 0 ? tabs.length : frontAt + 1, 0, tab);
  tabs = pinnedFirst(tabs);
  let recent = withFront(state.recent, id);
  const staysOpen = (t: EditorTab) => !!t.pinned || keep(t);
  while (tabs.length > MAX_TABS) {
    const longestOutOfSight = [...recent]
      .reverse()
      .find((r) => r !== id && !staysOpen(tabs.find((t) => tabId(t) === r)!));
    if (!longestOutOfSight) break;
    tabs = tabs.filter((t) => tabId(t) !== longestOutOfSight);
    recent = recent.filter((r) => r !== longestOutOfSight);
  }
  return { tabs, active: id, recent };
}

function replaceTab(state: TabState, old: EditorTab, tab: EditorTab): TabState {
  const id = tabId(tab);
  const recent = state.recent.filter((r) => r !== tabId(old));
  return {
    tabs: state.tabs.map((t) => (t === old ? tab : t)),
    active: id,
    recent: withFront(recent, id),
  };
}

/** Closes a tab; the one in front before it comes back, as in an IDE. */
export function closeTab(state: TabState, id: string): TabState {
  const tabs = state.tabs.filter((t) => tabId(t) !== id);
  const recent = state.recent.filter((r) => r !== id);
  if (state.active !== id) return { ...state, tabs, recent };
  const fallback =
    recent.find((r) => tabs.some((t) => tabId(t) === r)) ??
    (tabs.length ? tabId(tabs[tabs.length - 1]) : null);
  return { tabs, active: fallback, recent };
}

/** A file or folder moved, in the project or with `outside` outside it: tabs on it or under it follow. */
export function renameTabs(
  state: TabState,
  from: string,
  to: string,
  outside = false,
): TabState {
  const moved = (tab: EditorTab) =>
    tabIsWithin(tab, from, outside)
      ? { ...tab, path: to + tab.path.slice(from.length) }
      : tab;
  const movedIds = new Map(state.tabs.map((t) => [tabId(t), tabId(moved(t))]));
  const movedId = (id: string) => movedIds.get(id) ?? id;
  return {
    tabs: state.tabs.map(moved),
    active: state.active && movedId(state.active),
    recent: state.recent.map(movedId),
  };
}

/** A file or folder went to the Trash, in the project or with `outside` outside it: its tabs close. */
export function dropTabs(
  state: TabState,
  path: string,
  outside = false,
): TabState {
  let next = state;
  for (const tab of state.tabs)
    if (tabIsWithin(tab, path, outside)) next = closeTab(next, tabId(tab));
  return next;
}

/** Moves the tab `id` to where `before` is, or to the end. */
export function moveTab(
  state: TabState,
  id: string,
  before: string | null,
): TabState {
  const tab = state.tabs.find((t) => tabId(t) === id);
  if (!tab || id === before) return state;
  const tabs = state.tabs.filter((t) => t !== tab);
  const beforeAt = before ? tabs.findIndex((t) => tabId(t) === before) : -1;
  tabs.splice(beforeAt < 0 ? tabs.length : beforeAt, 0, tab);
  return { ...state, tabs: pinnedFirst(tabs) };
}

/** Pins or unpins a tab; it lands where the pinned tabs end, so unpinning drops it to the first unpinned place. */
export function setPinned(
  state: TabState,
  id: string,
  pinned: boolean,
): TabState {
  const tab = state.tabs.find((t) => tabId(t) === id);
  if (!tab || !!tab.pinned === pinned) return state;
  const others = state.tabs.filter((t) => t !== tab);
  const pinnedBefore = others.filter((t) => t.pinned).length;
  others.splice(pinnedBefore, 0, { ...kept(tab), pinned: pinned || undefined });
  return { ...state, tabs: others };
}

/** A saved tab state, or nothing usable. */
export function parseTabs(saved: string | null): TabState | undefined {
  if (!saved) return;
  try {
    const value = JSON.parse(saved) as Partial<TabState>;
    if (!Array.isArray(value.tabs)) return;
    const readTabs = value.tabs
      // A snapshot's text was only kept in memory, so its tab doesn't come back.
      .filter(
        (t): t is EditorTab =>
          !!t && typeof t.path === "string" && t.path.length > 0 && !t.snapshot,
      )
      .map(
        (t): EditorTab => ({
          path: t.path,
          ...(t.outside && { outside: true }),
          ...(t.pinned === true && { pinned: true }),
          ...(t.preview === true && { preview: true }),
        }),
      );
    // Pinned tabs all come back, whatever the limit; it only trims the rest.
    const pinned = readTabs.filter((t) => t.pinned);
    const unpinned = readTabs.filter((t) => !t.pinned);
    const tabs = [
      ...pinned,
      ...unpinned.slice(0, Math.max(0, MAX_TABS - pinned.length)),
    ];
    const ids = new Set(tabs.map(tabId));
    const active =
      typeof value.active === "string" && ids.has(value.active)
        ? value.active
        : null;
    const recent = Array.isArray(value.recent)
      ? value.recent.filter(
          (r): r is string => typeof r === "string" && ids.has(r),
        )
      : [];
    return { tabs, active, recent };
  } catch {
    return;
  }
}
