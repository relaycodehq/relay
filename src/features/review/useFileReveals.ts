import { useEffect, useState } from "react";
import {
  linksTo,
  type ProjectFileLink,
} from "../../../shared/project-file-links";
import { useRequests, type RequestChannel } from "../../lib/request-channel";
import type { ReviewFiles } from "./useReviewFiles";
import type { ReviewTriage } from "./useReviewTriage";

/**
 * Files asked for from outside the review, such as ones clicked in a PR
 * thread's chat, opened once the list has them; one the PR doesn't change
 * is an error.
 */
export function useFileReveals(
  channel: RequestChannel<ProjectFileLink> | undefined,
  { query: files, all }: ReviewFiles,
  result: ReviewTriage["result"],
  selectFile: (path: string) => void,
  onError: (e: unknown) => void,
) {
  const [reveal, setReveal] = useState<ProjectFileLink | null>(null);
  useRequests(channel, setReveal);
  useEffect(() => {
    if (!reveal || (!result && !files.data)) return;
    const match = all.find((f) => linksTo(reveal, f.filename));
    if (!match && !result && files.hasNextPage) {
      if (!files.isFetching && !files.isError) void files.fetchNextPage();
      return;
    }
    if (match) selectFile(match.filename);
    else
      onError(
        new Error(
          reveal.directory
            ? `This pull request doesn’t change anything in ${reveal.path}/.`
            : `This pull request doesn’t change ${reveal.path}.`,
        ),
      );
    setReveal(null);
  }, [
    reveal,
    all,
    result,
    files.data,
    files.hasNextPage,
    files.isFetching,
    files.isError,
  ]);
}
