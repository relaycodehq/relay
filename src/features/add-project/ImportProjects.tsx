import { useImperativeHandle, useState, type Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, SquareTerminal } from "lucide-react";
import {
  importAppNames,
  type ImportApp,
  type ProjectImportResult,
} from "../../../shared/project-import";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { forkThreadSettings } from "../agents/composer-settings";
import { ImportProjectRow, type ImportChoice } from "./ImportProjectRow";
import { AddProjectHeading } from "./AddProjectHeading";

export function ImportProjects({
  ref,
  onBack,
  onClose,
  onDone,
  onAskAgent,
  onBusy,
}: {
  ref?: Ref<{ back: () => void }>;
  onBack: () => void;
  onClose: () => void;
  onDone: (project: Project) => void;
  /** Hands the import to an agent in a thread of its own instead. */
  onAskAgent?: (app: ImportApp) => void;
  onBusy: (busy: boolean) => void;
}) {
  const qc = useQueryClient();
  const [app, setApp] = useState<ImportApp>();
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [includeChats, setIncludeChats] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<ProjectImportResult>();
  const projects = useQuery({
    queryKey: ["import-projects", app],
    queryFn: () => api.importProjects(app!),
    enabled: !!app,
    staleTime: 0,
    retry: false,
  });
  const selected = Object.entries(choices);
  const count = includeChats
    ? selected.reduce((n, [, choice]) => n + (choice.chats?.length ?? 0), 0)
    : 0;
  const loadingChats =
    includeChats && selected.some(([, choice]) => choice.chats === undefined);
  const selectable = projects.data?.filter((p) => !p.missing) ?? [];
  const picked = selectable.filter((p) => choices[p.key]).length;
  function chooseAll(on: boolean) {
    setChoices((old) => {
      if (!on) return {};
      const out = { ...old };
      for (const p of selectable) out[p.key] ??= {};
      return out;
    });
  }
  function choose(key: string, next: ImportChoice | undefined) {
    setChoices((old) => {
      const out = { ...old };
      if (next) out[key] = next;
      else delete out[key];
      return out;
    });
  }
  async function run() {
    if (!app || busy || !selected.length || loadingChats) return;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      const imported = await api.importSelectedProjects(
        app,
        selected.map(([key, choice]) => ({
          key,
          folder: choice.folder,
          chats: includeChats ? (choice.chats ?? []) : [],
        })),
      );
      for (const entry of imported.projects)
        for (const chat of entry.chats)
          if (chat.created)
            forkThreadSettings(
              `new:${entry.project.id}`,
              chat.chat.id,
              app,
              undefined,
            );
      setResult(imported);
      setChoices((old) => {
        const next = { ...old };
        for (const entry of imported.projects) {
          if (!imported.failures.some((f) => f.key === entry.key))
            delete next[entry.key];
          else if (next[entry.key]) {
            const done = new Set(
              entry.chats.flatMap((c) =>
                c.chat.fromTerminal ? [c.chat.fromTerminal.session] : [],
              ),
            );
            next[entry.key] = {
              ...next[entry.key],
              chats: next[entry.key]!.chats?.filter((id) => !done.has(id)),
            };
          }
        }
        return next;
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["project-chats"] }),
        qc.invalidateQueries({ queryKey: ["import-chats"] }),
        qc.invalidateQueries({ queryKey: ["import-projects", app] }),
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const complete = result && !result.failures.length;
  const importedChats =
    result?.projects.flatMap((p) => p.chats).filter((c) => c.created).length ??
    0;
  function back() {
    if (app) {
      setApp(undefined);
      setChoices({});
      setResult(undefined);
      setError(undefined);
    } else onBack();
  }
  useImperativeHandle(ref, () => ({ back }));
  return (
    <>
      <AddProjectHeading
        title={
          app ? `Import from ${importAppNames[app]}` : "Import from another app"
        }
        disabled={busy}
        onClose={onClose}
        onBack={back}
      />
      {!app ? (
        <div className="palette-body import-body">
          {(["codex", "claude"] as const).map((source) => (
            <button
              type="button"
              className="headline-project-row palette-row import-app"
              key={source}
              onClick={() => setApp(source)}
            >
              <SquareTerminal size={17} />
              <span>{importAppNames[source]}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="palette-body import-body">
            {projects.isPending && <p role="status">Looking for projects…</p>}
            {projects.isError && <ErrorBox error={projects.error} />}
            {complete ? (
              <div className="import-success" role="status">
                <strong>Import complete</strong>
                <p>
                  {result.projects.length}{" "}
                  {result.projects.length === 1 ? "project is" : "projects are"}{" "}
                  in Relay. {importedChats}{" "}
                  {importedChats === 1 ? "chat was" : "chats were"} imported.
                </p>
              </div>
            ) : (
              <>
                {!projects.isPending &&
                  !projects.isError &&
                  !projects.data?.length && (
                    <p>No local projects found for this app.</p>
                  )}
                {selectable.length > 1 && (
                  <label className="import-select-all">
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            picked > 0 && picked < selectable.length;
                      }}
                      checked={picked === selectable.length}
                      disabled={busy}
                      onChange={(e) => chooseAll(e.target.checked)}
                    />
                    {picked
                      ? `${picked} of ${selectable.length} selected`
                      : `Select all ${selectable.length}`}
                  </label>
                )}
                <ul className="import-projects">
                  {projects.data?.map((project) => (
                    <ImportProjectRow
                      key={`${app}:${project.key}`}
                      app={app}
                      project={project}
                      choice={choices[project.key]}
                      includeChats={includeChats}
                      busy={busy}
                      onChoose={(next) => choose(project.key, next)}
                    />
                  ))}
                </ul>
                {result?.failures.map((failure, i) => (
                  <ErrorBox
                    key={i}
                    error={`${projects.data?.find((p) => p.key === failure.key)?.name ?? "Project"}: ${failure.message}`}
                  />
                ))}
              </>
            )}
            {!!error && <ErrorBox error={error} />}
          </div>
          <div className="add-project-footer import-footer">
            {!complete && !!projects.data?.length && (
              <label>
                <input
                  type="checkbox"
                  checked={includeChats}
                  disabled={busy}
                  onChange={(e) => setIncludeChats(e.target.checked)}
                />
                Include saved chats
              </label>
            )}
            {!complete && onAskAgent && !!projects.data?.length && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAskAgent(app)}
              >
                Ask an agent…
              </button>
            )}
            <span role="status">
              {busy && !complete
                ? "Importing projects and chats…"
                : loadingChats
                  ? "Loading selected chats…"
                  : ""}
            </span>
            {complete ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => onDone(result.projects[0]!.project)}
              >
                Done
              </button>
            ) : (
              <>
                {!!result?.projects.length && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDone(result.projects[0]!.project)}
                  >
                    Done
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !selected.length || loadingChats}
                  onClick={() => void run()}
                >
                  {busy
                    ? "Importing…"
                    : !selected.length
                      ? "Import projects"
                      : `Import ${selected.length} ${selected.length === 1 ? "project" : "projects"}${count ? ` and ${count} ${count === 1 ? "chat" : "chats"}` : ""}`}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
