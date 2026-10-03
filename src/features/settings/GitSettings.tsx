import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { GitInfo } from "../../../shared/working-tree";
import { GitMark } from "./BrandIcons";
import { CliPathField, ToolRow, ToolRows, withCode } from "../../ui/ToolRow";
import { ErrorBox } from "../../ui/ui";

/** Settings → Integrations: the Git Relay runs, found or linked like the host CLIs. */
export function GitSettings() {
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ["git-info"],
    queryFn: () => api.gitInfo(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function apply(run: () => Promise<GitInfo | null>) {
    setBusy(true);
    setError(undefined);
    try {
      const next = await run();
      if (!next) return;
      qc.setQueryData(["git-info"], next);
      // Branches, changes and history were read with the old Git, or none.
      await qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "git-info",
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const git = info.data;
  if (!git)
    return info.error ? (
      <ErrorBox error={info.error} retry={() => void info.refetch()} />
    ) : (
      <p className="setting-muted">Looking for Git…</p>
    );
  const version = git.version?.replace(/^git version\s*/, "");
  return (
    <>
      <ToolRows>
        <ToolRow
          mark={<GitMark />}
          name="Git"
          version={version && `git ${version}`}
          state={git.version ? "ready" : "attention"}
          summary={(openDetails) =>
            git.version ? (
              "Relay runs it for branches, changes and history."
            ) : (
              <>
                {git.error ? withCode(git.error) : "Can't find Git."}{" "}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={openDetails}
                >
                  Link it…
                </button>
              </>
            )
          }
          details={
            <CliPathField
              program="git"
              path={git.path ?? undefined}
              linked={git.chosen}
              busy={busy}
              autoFocus={!git.version}
              onUse={(typed) => void apply(() => api.chooseGit(typed))}
              onUnlink={() => void apply(() => api.resetGit())}
            />
          }
        />
      </ToolRows>
      {!!error && <ErrorBox error={error} />}
    </>
  );
}
