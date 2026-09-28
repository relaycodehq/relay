import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { ErrorBox } from "./ui";
import { SettingsCard, SettingsFooter, SettingsRow } from "./SettingsCard";
import type { GitInfo } from "../../shared/working-tree";

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
  return (
    <>
      <SettingsCard>
        <SettingsRow
          label={
            !git
              ? "Looking for Git…"
              : git.version
                ? git.version.replace(/^git version/, "Git")
                : "Git unavailable"
          }
          hint={
            !git
              ? undefined
              : git.error
                ? git.error
                : `${git.chosen ? "Chosen" : "Found"}: ${git.path}`
          }
        />
        <SettingsFooter
          note={
            git?.chosen
              ? "Relay uses the Git you chose."
              : "Relay looks on PATH and in the usual install folders."
          }
        >
          {git?.chosen && (
            <button
              disabled={busy}
              onClick={() => void apply(() => api.resetGit())}
            >
              <RotateCcw size={14} />
              Find automatically
            </button>
          )}
          <button
            className={git && !git.version ? "primary" : ""}
            disabled={busy}
            onClick={() => void apply(() => api.chooseGit())}
          >
            <FolderOpen size={14} />
            Choose Git…
          </button>
        </SettingsFooter>
      </SettingsCard>
      {!!(error || info.error) && <ErrorBox error={error || info.error} />}
    </>
  );
}
