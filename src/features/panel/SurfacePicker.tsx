import { useEffect, type ReactNode } from "react";
import {
  Files,
  GitGraph,
  GitPullRequest,
  Globe,
  SquareTerminal,
} from "lucide-react";
import type { Surface } from "./panel-tabs";
import "./panel.css";

export const SURFACE_LABELS: Record<Surface, string> = {
  files: "Files",
  history: "History",
  terminal: "Terminal",
};
export const SURFACE_ICONS: Record<Surface, ReactNode> = {
  files: <Files size={13} />,
  history: <GitGraph size={13} />,
  terminal: <SquareTerminal size={13} />,
};

interface Item {
  id: Surface | "browser" | "pull";
  label: string;
  icon: ReactNode;
  letter: string;
  /** Not there yet, or not for this folder. */
  disabled?: boolean;
}

/** What an empty panel offers; each has a one-letter key while it shows. */
export function SurfacePicker({
  plain,
  onPick,
}: {
  /** A folder without Git has no history. */
  plain?: boolean;
  onPick: (surface: Surface) => void;
}) {
  const items: Item[] = [
    { id: "files", label: "Files", icon: <Files size={14} />, letter: "F" },
    {
      id: "history",
      label: "History",
      icon: <GitGraph size={14} />,
      letter: "H",
      disabled: plain,
    },
    {
      id: "terminal",
      label: "Terminal",
      icon: <SquareTerminal size={14} />,
      letter: "T",
    },
    {
      id: "browser",
      label: "Browser",
      icon: <Globe size={14} />,
      letter: "B",
      disabled: true,
    },
    {
      id: "pull",
      label: "Pull request",
      icon: <GitPullRequest size={14} />,
      letter: "P",
      disabled: true,
    },
  ];
  const usable = items.filter(
    (item): item is Item & { id: Surface } => !item.disabled,
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (
        (e.target as Element | null)?.closest?.(
          "input, textarea, select, [contenteditable]",
        )
      )
        return;
      const hit = usable.find(
        (item) => item.letter.toLowerCase() === e.key.toLowerCase(),
      );
      if (!hit) return;
      e.preventDefault();
      onPick(hit.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <div className="surface-picker">
      <h3>Open a surface</h3>
      <div className="surface-picker-list" role="menu">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="surface-picker-item"
            disabled={item.disabled}
            aria-keyshortcuts={item.letter}
            onClick={() => onPick(item.id as Surface)}
          >
            {item.icon}
            <span className="surface-picker-label">{item.label}</span>
            <kbd aria-hidden="true">{item.letter}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
