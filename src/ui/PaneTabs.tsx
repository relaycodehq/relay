import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import "./pane-tabs.css";

export interface PaneTab {
  key: string;
  label: string;
  icon: ReactNode;
  /** Kept open, like Files over an unsaved edit. */
  closeDisabled?: boolean;
  closeLabel?: string;
  /** Opened for the user, who hasn't looked at it yet: a dot. */
  unseen?: boolean;
}

/** A tab's widest, as .pane-tab-host .pane-tab's max-width. */
const TAB_MAX = 240;

/**
 * Whether the tabs' labels don't all fit the strip, so every tab shows its
 * icon alone rather than a clipped word. Each label's full width is read
 * from the DOM either way, so the answer doesn't flip once the labels go.
 */
function useIconsOnly(list: HTMLDivElement | null, tabs: PaneTab[]) {
  const [iconsOnly, setIconsOnly] = useState(false);
  const labels = tabs.map((t) => t.label).join("\n");
  useLayoutEffect(() => {
    if (!list) return;
    const fit = () => {
      const compact = list.classList.contains("icons-only");
      let need = 0;
      for (const child of list.children) {
        const width = child.getBoundingClientRect().width;
        const label = child.querySelector<HTMLElement>(".pane-tab-label");
        if (!label) {
          need += width;
          continue;
        }
        const gap = parseFloat(
          getComputedStyle(label.parentElement!).columnGap,
        );
        const bare = compact ? width : width - label.clientWidth - gap;
        need += Math.min(TAB_MAX, bare + gap + label.scrollWidth);
      }
      setIconsOnly(need > list.clientWidth + 0.5);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list, labels]);
  return iconsOnly;
}

/** Tabs along a pane's header; each closes on its own, + adds one. */
export function PaneTabs({
  tabs,
  front,
  onFront,
  onClose,
  add,
}: {
  tabs: PaneTab[];
  front: string | null;
  onFront: (key: string) => void;
  onClose: (key: string) => void;
  add?: { label: string; active?: boolean; onClick: () => void };
}) {
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const iconsOnly = useIconsOnly(list, tabs);
  // Too narrow even for the icons, the strip scrolls; keep the front tab in it.
  const frontTab = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!list) return;
    const reveal = () => {
      const tab = frontTab.current?.getBoundingClientRect();
      const strip = list.getBoundingClientRect();
      if (!tab) return;
      if (tab.left < strip.left) list.scrollLeft += tab.left - strip.left;
      else if (tab.right > strip.right)
        list.scrollLeft += tab.right - strip.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list, front, iconsOnly]);
  return (
    <div
      className={`pane-tabs ${iconsOnly ? "icons-only" : ""}`}
      role="tablist"
      ref={setList}
    >
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className={`pane-tab-host ${front === tab.key ? "active" : ""}`}
        >
          <button
            type="button"
            role="tab"
            ref={front === tab.key ? frontTab : undefined}
            aria-selected={front === tab.key}
            aria-label={tab.label}
            title={tab.label}
            className={`pane-tab ${front === tab.key ? "active" : ""}`}
            onClick={() => onFront(tab.key)}
          >
            {tab.icon}
            <span className="pane-tab-label">{tab.label}</span>
            {tab.unseen && <span className="unseen-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="pane-tab-close"
            aria-label={tab.closeLabel ?? `Close ${tab.label.toLowerCase()}`}
            title="Close"
            disabled={tab.closeDisabled}
            onClick={() => onClose(tab.key)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {add && (
        <button
          type="button"
          className={`pane-tab pane-tab-add ${add.active ? "active" : ""}`}
          aria-label={add.label}
          title={add.label}
          onClick={add.onClick}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
