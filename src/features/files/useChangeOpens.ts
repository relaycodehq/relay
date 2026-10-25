import { useRef, useState } from "react";
import type { FilesRequest } from "./file-link-target";

/**
 * Opens one file of a diff once its versions are read. Only the last pick
 * opens, however the answers arrive; its failure is kept to show.
 */
export function useChangeOpens(show: (request: FilesRequest) => void) {
  const [error, setError] = useState<unknown>();
  const latest = useRef(0);
  const openChange = (read: () => Promise<FilesRequest>) => {
    const pick = ++latest.current;
    setError(undefined);
    read().then(
      (request) => {
        if (pick === latest.current) show(request);
      },
      (e) => {
        if (pick === latest.current) setError(e);
      },
    );
  };
  return { openChange, error };
}
