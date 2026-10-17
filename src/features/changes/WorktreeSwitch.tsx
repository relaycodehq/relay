import { createPortal } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { WorktreeStatus } from "../../../shared/projects";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import type { PaneSlots } from "../../ui/WorkspacePanes";
import "../agents/composer-model-picker.css";
import "./worktree-switch.css";

type Showing = "uncommitted" | "source" | "turn";

/**
 * What a worktree thread's Changes pane shows, picked from the pane's title:
 * what isn't committed yet, everything its branch has that the source branch
 * doesn't, or the one turn's diff a link opened.
 */
export function WorktreeSwitch({
  slots,
  status,
  where,
  showing,
  turnFiles,
  onUncommitted,
  onAgainstSource,
}: {
  slots: PaneSlots;
  status: WorktreeStatus;
  /** The worktree's workspace, whose uncommitted files are counted. */
  where: string;
  showing: Showing;
  /** How many files the shown turn changed, while one shows. */
  turnFiles?: number;
  onUncommitted: () => void;
  onAgainstSource: () => void;
}) {
  // The shell polls this tree; reading it here costs nothing more.
  const uncommitted = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
  }).data?.changes.length;
  if (!slots.title) return null;
  const from = status.from ?? "its source branch";
  const scopes: Record<
    Showing,
    { label: string; detail: string; count?: number }
  > = {
    uncommitted: {
      label: "Uncommitted",
      detail: "What isn’t committed yet",
      count: uncommitted,
    },
    source: {
      label: `Against ${from}`,
      detail: `Everything this worktree has that ${from} doesn’t, committed or not`,
      count: status.files.length,
    },
    turn: {
      label: "This turn",
      detail: "What the turn you opened changed",
      count: turnFiles,
    },
  };
  const item = (scope: Showing, pick: () => void) => (
    <Menu.Item
      className="composer-select-item worktree-scope-item"
      data-current={scope === showing || undefined}
      onClick={pick}
    >
      <span>
        {scopes[scope].label}
        <small>{scopes[scope].detail}</small>
      </span>
      {scopes[scope].count !== undefined && <em>{scopes[scope].count}</em>}
    </Menu.Item>
  );
  const current = scopes[showing];
  return createPortal(
    <span className="worktree-switch">
      <span className="worktree-switch-sep" aria-hidden>
        /
      </span>
      <Menu.Root>
        <Menu.Trigger
          className="worktree-scope"
          aria-label={`Showing: ${current.label}`}
          title={current.detail}
        >
          <span className="worktree-scope-label">{current.label}</span>
          {current.count !== undefined && <em>{current.count}</em>}
          <ChevronDown size={12} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className="composer-popup-positioner"
            align="start"
            sideOffset={6}
          >
            <Menu.Popup className="composer-select-popup worktree-scope-menu">
              {item("uncommitted", onUncommitted)}
              {item("source", onAgainstSource)}
              {showing === "turn" && (
                <>
                  <Menu.Separator className="composer-menu-separator" />
                  {item("turn", () => {})}
                </>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>,
    slots.title,
  );
}
