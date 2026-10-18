import { Fragment, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, Folder, FolderGit2 } from "lucide-react";
import type { ChatWorkspace, Project } from "../../../shared/projects";
import type { HandoffTarget } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import { DeviceIcon } from "../handoff/DeviceIcon";
import {
  canPick,
  cloneSetupPrompt,
  targetLine,
  useCloneThere,
  whileCloning,
} from "../handoff/clone-there";
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
 * is a third answer, the thread starting there in a worktree of its own;
 * one without the project clones it first, and when that fails, an agent
 * in a new thread here can set it up.
 */
export function NewWorkspacePicker({
  project,
  worktree,
  disabled,
  onStartThread,
}: {
  project: Project;
  worktree: ThreadWorktree;
  disabled?: boolean;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const computers = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
  });
  const targetsKey = ["start-targets", project.id];
  const targets = useQuery({
    queryKey: targetsKey,
    queryFn: () => api.startTargets(project.id),
    enabled: open && !!computers.data?.length,
    staleTime: 5_000,
    refetchInterval: (q) => whileCloning(q.state.data),
  });
  const cloneThere = useCloneThere(project.id, targetsKey);
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
                    const pick = () => {
                      setStartOn({ id: c.id, name: c.name });
                      setOpen(false);
                    };
                    return (
                      <Fragment key={c.id}>
                        <Menu.Item
                          className="composer-select-item handoff-target"
                          disabled={!targets.data || !canPick(target)}
                          // A clone keeps the menu open to show how far it is.
                          closeOnClick={!!target.project}
                          onClick={() =>
                            target.project
                              ? pick()
                              : cloneThere(c as HandoffTarget, pick)
                          }
                        >
                          <DeviceIcon name={c.name} size={16} />
                          <span className="handoff-target-text">
                            <span>{c.name}</span>
                            <small title={target.cloneError}>
                              {!targets.data
                                ? "Checking…"
                                : targetLine(target, "Starts")}
                            </small>
                          </span>
                        </Menu.Item>
                        {target.cloneError && onStartThread && (
                          <Menu.Item
                            className="composer-select-item handoff-target handoff-setup"
                            onClick={() =>
                              void onStartThread(
                                cloneSetupPrompt(c as HandoffTarget),
                                false,
                              )
                            }
                          >
                            <Bot size={14} />
                            <span className="handoff-target-text">
                              <span>Let an agent set it up…</span>
                            </span>
                          </Menu.Item>
                        )}
                      </Fragment>
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
