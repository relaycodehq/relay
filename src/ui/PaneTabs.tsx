import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import "./pane-tabs.css";

export interface PaneTab {
  key: string;
  label: string;
  icon: ReactNode;
  /** Kept open, like Files over an unsaved edit. */
  closeDisabled?: boolean;
  closeLabel?: string;
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
  return (
    <div className="pane-tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className={`pane-tab-host ${front === tab.key ? "active" : ""}`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={front === tab.key}
            title={tab.label}
            className={`pane-tab ${front === tab.key ? "active" : ""}`}
            onClick={() => onFront(tab.key)}
          >
            {tab.icon}
            <span>{tab.label}</span>
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
