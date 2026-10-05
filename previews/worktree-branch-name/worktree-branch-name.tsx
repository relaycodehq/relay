// Where a new worktree thread's branch name is chosen, three ways, on sample
// data. Type in the composer: the branch follows it until you edit the name.
// A is what was built (src/features/thread/WorktreeBranchField.tsx).
// Open http://127.0.0.1:5177/previews/worktree-branch-name/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  ChevronDown,
  Folder,
  FolderGit2,
  GitBranch,
} from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/changes/worktrees.css";
import { initAppearance } from "../../src/lib/appearance";
import { WorkspaceControl } from "../../src/features/thread/WorktreeControls";
import type { ThreadWorktree } from "../../src/features/thread/useThreadWorktree";
import type { ChatWorkspace } from "../../shared/projects";
import { branchNameProblem } from "../../shared/branch-names";
import "./worktree-branch-name.css";

initAppearance();

// Sample: branches this repository already has.
const taken = new Set(["main", "relay/fix-login-redirect", "feature/search"]);

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "thread";
function suggested(prompt: string) {
  if (!prompt.trim()) return "";
  const leaf = slug(prompt.trim().slice(0, 65));
  for (let n = 1; ; n++) {
    const name = `relay/${n === 1 ? leaf : `${leaf}-${n}`}`;
    if (!taken.has(name)) return name;
  }
}
function problem(name: string) {
  return (
    branchNameProblem(name) ??
    (taken.has(name) ? `${name} already exists.` : undefined)
  );
}

type Field = {
  value: string;
  placeholder: string;
  edited: boolean;
  problem?: string;
  onChange: (value: string) => void;
};

function BranchInput({ field, label }: { field: Field; label?: string }) {
  return (
    <input
      className="worktree-branch-input"
      aria-label={label ?? "Branch for the new worktree"}
      aria-invalid={!!field.problem || undefined}
      spellCheck={false}
      autoComplete="off"
      value={field.value}
      placeholder={field.placeholder}
      onChange={(e) => field.onChange(e.target.value)}
    />
  );
}

const options = {
  slot: "A · In the branch slot",
  menu: "B · In the workspace menu",
  strip: "C · Line in the composer",
} as const;
type Option = keyof typeof options;

function Preview() {
  const [option, setOption] = useState<Option>(
    (new URLSearchParams(location.search).get("o") as Option) ?? "slot",
  );
  const [workspace, setWorkspace] = useState<ChatWorkspace>("worktree");
  const [prompt, setPrompt] = useState("Fix the login redirect loop");
  const [typed, setTyped] = useState("");
  const auto = suggested(prompt);
  const name = typed.trim() || auto;
  const field: Field = {
    value: typed || auto,
    placeholder: "Named after your first message",
    edited: !!typed,
    problem: typed.trim() ? problem(typed.trim()) : undefined,
    onChange: (v) => setTyped(v === auto ? "" : v),
  };
  const worktree = { workspace, setWorkspace } as unknown as ThreadWorktree;
  const pick = (o: Option) => {
    setOption(o);
    history.replaceState(null, "", `?o=${o}`);
  };
  const checkoutBranch = (
    <button type="button" className="composer-branch-trigger">
      <GitBranch size={13} />
      <span>main</span>
      <ChevronDown size={12} />
    </button>
  );
  const isWorktree = workspace === "worktree";
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 2 }}>
        Sample data; main, relay/fix-login-redirect and feature/search exist.{" "}
        {(Object.keys(options) as Option[]).map((o) => (
          <button
            key={o}
            aria-pressed={o === option}
            style={{ marginRight: 6, fontWeight: o === option ? 600 : 400 }}
            onClick={() => pick(o)}
          >
            {options[o]}
          </button>
        ))}
      </p>
      <div className="project-chat empty-thread" style={{ marginTop: 160 }}>
        <div className="thread-context-controls">
          {option === "menu" ? (
            <MenuOption
              workspace={workspace}
              onWorkspace={setWorkspace}
              field={field}
              name={name}
            />
          ) : (
            <WorkspaceControl
              worktree={worktree}
              running={false}
              busy={false}
              onOpenTurnDiff={() => {}}
              onError={() => {}}
            />
          )}
          {option === "slot" && isWorktree && (
            <>
              <span className="worktree-branch-field">
                <GitBranch size={13} />
                <BranchInput field={field} />
                {field.problem && (
                  <span className="worktree-branch-problem" role="alert">
                    {field.problem}
                  </span>
                )}
              </span>
              <span className="worktree-branch-from">from</span>
            </>
          )}
          {checkoutBranch}
        </div>
        <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
          {option === "strip" && isWorktree && (
            <div className="worktree-branch-strip">
              <span>New branch</span>
              <BranchInput field={field} />
              {field.problem ? (
                <span className="worktree-branch-problem" role="alert">
                  {field.problem}
                </span>
              ) : (
                <span className="worktree-branch-from">from main</span>
              )}
            </div>
          )}
          <textarea
            className="composer-prompt-input"
            style={{
              width: "100%",
              minHeight: 70,
              border: 0,
              background: "transparent",
              padding: 14,
              resize: "none",
              color: "var(--text)",
            }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask about the code, plan a change, or build something…"
          />
        </form>
      </div>
    </div>
  );
}

/** B: the workspace control opens a popover; the branch is named under New worktree. */
function MenuOption({
  workspace,
  onWorkspace,
  field,
  name,
}: {
  workspace: ChatWorkspace;
  onWorkspace: (w: ChatWorkspace) => void;
  field: Field;
  name: string;
}) {
  const isWorktree = workspace === "worktree";
  const Icon = isWorktree ? FolderGit2 : Folder;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="composer-branch-trigger workspace-trigger"
        title="Where this thread works"
      >
        <Icon size={13} />
        <span>{isWorktree ? "New worktree" : "Project folder"}</span>
        {isWorktree && field.problem && <i className="worktree-dot danger" />}
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup className="composer-select-popup worktree-branch-popup">
            <div className="composer-menu-label">Workspace</div>
            {(
              [
                ["checkout", "Project folder", Folder],
                ["worktree", "New worktree", FolderGit2],
              ] as const
            ).map(([w, label, ItemIcon]) => (
              <button
                key={w}
                type="button"
                className="composer-select-item workspace-item"
                onClick={() => onWorkspace(w)}
              >
                <ItemIcon size={14} />
                {label}
                {workspace === w && (
                  <Check size={13} style={{ marginLeft: "auto" }} />
                )}
              </button>
            ))}
            {isWorktree && (
              <label className="worktree-branch-popup-field">
                <span>Branch</span>
                <BranchInput field={field} label="Branch" />
                <small className={field.problem ? "danger" : undefined}>
                  {field.problem ??
                    (name
                      ? `Made from main`
                      : "Named after your first message")}
                </small>
              </label>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
