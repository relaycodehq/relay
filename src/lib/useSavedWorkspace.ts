import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Bootstrap, WorkspaceState } from "../../shared/types";
import { api } from "./api";

/** Saves where the Pull requests page is, so it opens there next time. */
export function useSavedWorkspace(
  workspace: WorkspaceState,
  onError: (e: unknown) => void,
) {
  const qc = useQueryClient();
  const { pull, file, query, state } = workspace;
  useEffect(() => {
    // The page remounts from the bootstrap snapshot, so keep that current too.
    qc.setQueryData<Bootstrap>(
      ["bootstrap"],
      (boot) => boot && { ...boot, workspace },
    );
    void api.saveWorkspace(workspace).catch(onError);
  }, [pull, file, query, state]);
}
