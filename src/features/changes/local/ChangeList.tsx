import type { RefObject } from "react";
import { ChevronRight } from "lucide-react";
import {
  changeKind,
  type ChangeArea,
  type GitAction,
  type WorkingChange,
} from "../../../../shared/working-tree";
import {
  byFolder,
  changeLabels,
  type ChangeSection,
  type SelectedChange,
} from "../working-changes";
import { FileEntryIcon } from "../../../ui/ui";
import { LocalChangeMenu } from "../LocalChangeMenu";

interface Props {
  sections: ChangeSection[];
  revision: string;
  selected: SelectedChange | null;
  grouped: boolean;
  collapsed: ChangeArea[];
  onCollapse: (area: ChangeArea, collapse: boolean) => void;
  busy: boolean;
  projectId?: string;
  listRef: RefObject<HTMLDivElement | null>;
  onAct: (action: GitAction) => void;
  onPick: (path: string, area: ChangeArea) => void;
  onOpenFile?: (path: string, line?: number) => void;
  onTrashed: () => void;
  onError: (e: unknown) => void;
}

/** The staged and working lists, each flat or under its folders. */
export function ChangeList({ sections, listRef, ...props }: Props) {
  return (
    <div className="working-file-list" ref={listRef}>
      {sections.map((s) => (
        <Section key={s.area} section={s} {...props} />
      ))}
    </div>
  );
}

type SectionProps = Omit<Props, "sections" | "listRef"> & {
  section: ChangeSection;
};

function Section(props: SectionProps) {
  const { section: s, revision, grouped, collapsed, busy, onAct } = props;
  const open = !collapsed.includes(s.area),
    staged = s.area === "staged";
  const toggle = (paths: string[]) => onAct({ kind: s.kind, revision, paths });
  return (
    <section>
      <header>
        <button
          className="change-section-toggle"
          aria-expanded={open}
          onClick={() => props.onCollapse(s.area, open)}
        >
          <ChevronRight size={13} />
        </button>
        <input
          type="checkbox"
          aria-label={staged ? "Unstage all" : "Stage all"}
          checked={staged && !!s.files.length}
          disabled={busy || !s.files.length}
          onChange={() => toggle(s.files.map((c) => c.path))}
        />
        <strong>{s.title}</strong>
        <span>
          {s.files.length} {s.files.length === 1 ? "file" : "files"}
        </span>
      </header>
      {open &&
        (grouped
          ? [...byFolder(s.files)].map(([folder, files]) => (
              <div
                key={folder}
                role="group"
                aria-label={folder || "Repository root"}
              >
                <div className="working-folder">
                  <input
                    type="checkbox"
                    aria-label={`${staged ? "Unstage" : "Stage"} ${folder || "repository root"}`}
                    checked={staged}
                    disabled={busy}
                    onChange={() => toggle(files.map((c) => c.path))}
                  />
                  <span title={folder || "Repository root"}>
                    {folder || "/"}
                  </span>
                </div>
                {files.map((c) => (
                  <ChangeRow key={c.path} change={c} nested {...props} />
                ))}
              </div>
            ))
          : s.files.map((c) => (
              <ChangeRow key={c.path} change={c} nested={false} {...props} />
            )))}
    </section>
  );
}

function ChangeRow({
  change: c,
  nested,
  section: s,
  revision,
  selected,
  busy,
  projectId,
  onAct,
  onPick,
  onOpenFile,
  onTrashed,
  onError,
}: SectionProps & { change: WorkingChange; nested: boolean }) {
  const staged = s.area === "staged",
    kind = changeKind(staged ? c.index : c.worktree, c.conflict),
    slash = c.path.lastIndexOf("/");
  return (
    <LocalChangeMenu
      change={c}
      area={s.area}
      projectId={projectId}
      busy={busy}
      trigger={
        <div
          className={`working-file ${nested ? "nested" : ""} ${selected?.path === c.path && selected.area === s.area ? "selected" : ""}`}
        >
          <input
            type="checkbox"
            aria-label={`${staged ? "Unstage" : "Stage"} ${c.path}`}
            checked={staged}
            disabled={busy}
            onChange={() => onAct({ kind: s.kind, revision, paths: [c.path] })}
          />
          <button
            className="change-select"
            aria-label={`${changeLabels[kind]} ${c.path}`}
            title={`${changeLabels[kind]}: ${c.previousPath ? `${c.previousPath} → ` : ""}${c.path}`}
            onClick={() => onPick(c.path, s.area)}
          >
            <FileEntryIcon path={c.path} directory={false} />
            <span className={`change-name ${kind}`}>
              {c.path.slice(slash + 1)}
            </span>
            {!nested && slash > 0 && (
              <span className="change-dir">{c.path.slice(0, slash)}</span>
            )}
          </button>
        </div>
      }
      onStage={() => onAct({ kind: s.kind, revision, paths: [c.path] })}
      onIgnore={(file) =>
        onAct({ kind: "ignore", revision, paths: [c.path], file })
      }
      onDiscard={() =>
        onAct({ kind: "discard", revision, paths: [c.path], area: s.area })
      }
      onShowArea={(area) => onPick(c.path, area)}
      onOpenFile={onOpenFile}
      onTrashed={onTrashed}
      onError={onError}
    />
  );
}
