import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Folder, FolderGit2 } from "lucide-react";
import type { ChatWorkspace, Project } from "../../../shared/projects";
import type { HandoffTarget } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import { DeviceIcon } from "../handoff/DeviceIcon";
import type { ThreadWorktree } from "./useThreadWorktree";
import "../changes/worktrees.css";
import "../changes/branch-picker.css";
import "../handoff/handoff.css";

const workspaces: Record<
  ChatWorkspace,
  { label: string; icon: typeof Folder }
> = {
  checkout: { label: "Current checkout", icon: Folder },
  worktree: { label: "New worktree", icon: FolderGit2 },
};

/**
 * Before a thread's first message: where it will work. A paired computer
 * is a third answer, the thread starting there in a worktree of its own.
 */
export function NewWorkspacePicker({
  project,
  worktree,
  disabled,
}: {
  project: Project;
  worktree: ThreadWorktree;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const computers = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
  });
  const targets = useQuery({
    queryKey: ["start-targets", project.id],
    queryFn: () => api.startTargets(project.id),
    enabled: open && !!computers.data?.length,
    staleTime: 5_000,
  });
  const { startOn, setStartOn } = worktree;
  const Icon = workspaces[worktree.workspace].icon;
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger"
        disabled={disabled}
        title="Where this thread works"
      >
        {startOn ? (
          <DeviceIcon name={startOn.name} size={13} />
        ) : (
          <Icon size={13} />
        )}
        <span>
          {startOn
            ? `On ${startOn.name}`
            : workspaces[worktree.workspace].label}
        </span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup
            className={`composer-select-popup${computers.data?.length ? " handoff-menu" : ""}`}
            aria-label="Workspace"
          >
            <Menu.Group>
              <Menu.GroupLabel className="composer-menu-label">
                Workspace
              </Menu.GroupLabel>
              {(Object.keys(workspaces) as ChatWorkspace[]).map((w) => {
                const ItemIcon = workspaces[w].icon;
                return (
                  <Menu.Item
                    key={w}
                    className="composer-select-item workspace-item"
                    onClick={() => {
                      setStartOn(undefined);
                      worktree.setWorkspace(w);
                    }}
                  >
                    <ItemIcon size={14} />
                    {workspaces[w].label}
                  </Menu.Item>
                );
              })}
            </Menu.Group>
            {!!computers.data?.length && (
              <>
                <Menu.Separator className="handoff-menu-separator" />
                <Menu.Group>
                  <Menu.GroupLabel className="composer-menu-label">
                    On another computer
                  </Menu.GroupLabel>
                  {(targets.data ?? computers.data).map((c) => {
                    const target: Partial<HandoffTarget> = c;
                    return (
                      <Menu.Item
                        key={c.id}
                        className="composer-select-item handoff-target"
                        disabled={!target.project}
                        onClick={() => setStartOn({ id: c.id, name: c.name })}
                      >
                        <DeviceIcon name={c.name} size={16} />
                        <span className="handoff-target-text">
                          <span>{c.name}</span>
                          <small>
                            {!targets.data
                              ? "Checking…"
                              : target.project
                                ? `Starts in ${target.project.name}`
                                : target.problem}
                          </small>
                        </span>
                      </Menu.Item>
                    );
                  })}
                </Menu.Group>
                <p className="handoff-menu-note">
                  It starts there in a worktree of its own, from this branch's
                  last commit. You follow it here as usual.
                </p>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Under the row when the thread starts elsewhere: what stays behind here. */
export function StartOnNote({
  project,
  worktree,
}: {
  project: Project;
  worktree: ThreadWorktree;
}) {
  // The shell's poller fills this; reading it here adds no Git calls.
  const tree = useQuery({
    queryKey: workingTreeKey(project.id),
    queryFn: () => api.projectWorkingTree(project.id),
    enabled: false,
  });
  const files = tree.data?.changes.length ?? 0;
  if (!worktree.startOn || !files) return null;
  return (
    <p className="start-on-note">
      {files} uncommitted {files === 1 ? "file" : "files"} here{" "}
      {files === 1 ? "doesn't" : "don't"} go along. {worktree.startOn.name}{" "}
      starts from {tree.data!.branch || "this branch"} as last committed.
    </p>
  );
}
