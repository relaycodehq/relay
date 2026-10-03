import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull } from "../../../shared/types";
import { api } from "../../lib/api";

/** The local checkout linked to a PR's repository, and linking one. */
export function useLinkedFolder(pull: Pull, onError: (e: unknown) => void) {
  const qc = useQueryClient();
  const folder = useQuery({
    queryKey: ["folder", pull.owner, pull.name],
    queryFn: () => api.folder(pull),
  });
  const link = async () => {
    try {
      const result = await api.linkFolder(pull);
      if (result) qc.setQueryData(["folder", pull.owner, pull.name], result);
    } catch (e) {
      onError(e);
    }
  };
  return { folder, link };
}
