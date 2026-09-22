import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { FilePair, Pull } from "../../shared/types";
import type { LiveSyncApi } from "../../shared/live-sync";
import { api } from "../lib/api";
import { ErrorBox, Modal } from "./ui";
import { WorkingDiff } from "./WorkingDiff";
import "./working-tree.css";
type Conflict = Awaited<ReturnType<LiveSyncApi["liveSyncConflict"]>> & {
  path: string;
};
export function LiveSyncControls({
  pull,
  chatId,
}: {
  pull?: Pull;
  chatId?: string;
}) {
  const target = chatId ? { chatId } : pull!;
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [conflict, setConflict] = useState<Conflict | null>(null);
  const query = useQuery({
    queryKey: ["live-sync", target],
    queryFn: () => api.liveSyncState(target),
    refetchInterval: 2000,
  });
  const state = query.data;
  const pair = useMemo<FilePair | null>(
    () =>
      conflict
        ? {
            old: conflict.local
              ? {
                  name: conflict.path,
                  contents: conflict.local.contents,
                  cacheKey: `local-${conflict.localHash}`,
                }
              : null,
            next: conflict.shared
              ? {
                  name: conflict.path,
                  contents: conflict.shared.contents,
                  cacheKey: `shared-${conflict.revision}`,
                }
              : null,
            binary: false,
          }
        : null,
    [conflict],
  );
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await query.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const label = state?.active
    ? state.error
      ? "Sync paused"
      : state.conflicts.length
        ? `${state.conflicts.length} sync conflicts`
        : state.excluded.length
          ? "Sync needs attention"
          : "Live sync on"
    : "Live sync";
  return (
    <>
      <button
        className={`live-sync-button ${state?.active ? "active" : ""}`}
        onClick={() => setOpen(true)}
      >
        <RefreshCw size={13} />
        {label}
      </button>
      {open && (
        <Modal
          title="Live shared files"
          className="sync-modal"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setConflict(null);
            }
          }}
        >
          {!!error && <ErrorBox error={error} />}{" "}
          {query.error && <ErrorBox error={query.error} />}
          {conflict ? (
            <>
              <p>
                <strong>{conflict.path}</strong>
              </p>
              <p className="muted">
                Your saved file is on the left. {conflict.author}’s shared
                version is on the right. Choosing one replaces the other
                version. You can also merge in your editor, then choose your
                local version.
              </p>
              <div className="sync-conflict-diff">
                <WorkingDiff pair={pair!} />
              </div>
              <div className="sync-actions">
                <button disabled={busy} onClick={() => setConflict(null)}>
                  Back
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.liveSyncResolve(
                        target,
                        conflict.path,
                        "shared",
                        conflict.revision,
                        conflict.localHash,
                      );
                      setConflict(null);
                    })
                  }
                >
                  Use shared version
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.liveSyncResolve(
                        target,
                        conflict.path,
                        "local",
                        conflict.revision,
                        conflict.localHash,
                      );
                      setConflict(null);
                    })
                  }
                >
                  Share my local version
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Sync saved files with colleagues in this conversation. Edits
                from this app, your IDE and local agents appear in everyone’s
                linked checkout, usually within a few seconds.
              </p>
              <p className="muted">
                This shares changed UTF-8 text, including new files, through
                your room server. Git-ignored files, binary files, symlinks and
                files over 2 MiB are excluded. Unsaved buffers, staging and
                commits stay on your computer.
              </p>
              <p className="muted">
                Everyone needs the same base commit locally. Use a dedicated
                checkout for this review; switching branches pauses sync.
                Restarting the app requires Resume—your sync checkpoint is kept.
              </p>
              {state?.base && (
                <p>
                  <code>
                    {state.branch} · {state.base.slice(0, 8)}
                  </code>{" "}
                  · {state.files} shared files
                </p>
              )}
              {state?.error && <ErrorBox error={state.error} />}
              {!!state?.conflicts.length && (
                <section className="sync-issues">
                  <h3>Resolve conflicting edits</h3>
                  {state.conflicts.map((c) => (
                    <button
                      disabled={busy}
                      key={c.path}
                      onClick={() =>
                        void act(async () =>
                          setConflict({
                            ...(await api.liveSyncConflict(target, c.path)),
                            path: c.path,
                          }),
                        )
                      }
                    >
                      <span>{c.path}</span>
                      <small>{c.author}</small>
                    </button>
                  ))}
                </section>
              )}
              {!!state?.excluded.length && (
                <details className="sync-issues">
                  <summary>
                    {state.excluded.length} files need attention or are excluded
                  </summary>
                  {state.excluded.map((c) => (
                    <p key={c.path}>
                      <strong>{c.path}</strong>
                      <br />
                      <small>{c.reason}</small>
                    </p>
                  ))}
                </details>
              )}
              <div className="sync-actions">
                <button
                  hidden={!pull}
                  disabled={busy}
                  onClick={() => void api.linkFolder(pull!).catch(setError)}
                >
                  Link local folder
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      state?.active
                        ? api.liveSyncStop(target)
                        : api.liveSyncStart(target),
                    )
                  }
                >
                  {busy
                    ? "Connecting…"
                    : state?.active
                      ? "Pause live sync"
                      : "Enable / resume live sync"}
                </button>
              </div>
              <small className="muted">
                Only enable this with people you trust: shared files are written
                into your checkout. Builds and tools can execute code from those
                files. Nothing is committed or pushed automatically.
              </small>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
