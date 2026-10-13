import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull } from "../../../shared/types";
import { api } from "../../lib/api";

/** The local checkout linked to a PR's repository, and linking one. */
export function useLinkedFolder(pull: Pull, onError: (e: unknown) => void) {
  const qc = useQueryClient();
  const key = ["folder", pull.server, pull.owner, pull.name];
  const folder = useQuery({
    queryKey: key,
    queryFn: () => api.folder(pull),
  });
  const link = async () => {
    try {
      const result = await api.linkFolder(pull);
      if (result) qc.setQueryData(key, result);
    } catch (e) {
      onError(e);
    }
  };
  return { folder, link };
}
