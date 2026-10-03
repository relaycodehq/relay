import { useQuery } from "@tanstack/react-query";
import type { ChangedFile, Pull } from "../../../shared/types";
import { api } from "../../lib/api";

/** A PR file at its merge base and at the head, read once per head. */
export const usePullFileContents = (pull: Pull, file: ChangedFile) =>
  useQuery({
    queryKey: [
      "contents",
      pull.owner,
      pull.name,
      pull.number,
      pull.head.sha,
      pull.merge_base,
      file.filename,
    ],
    queryFn: () => api.contents(pull, file, pull.head.sha, pull.merge_base),
    gcTime: 0,
    staleTime: Infinity,
  });
