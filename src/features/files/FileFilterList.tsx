import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileCode2 } from "lucide-react";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/poll";
import { ErrorBox } from "../../ui/ui";
import type { ChecksController } from "../checks/useProjectChecks";

/** The project's files with `filter` in their path, in place of the tree. */
export function FileFilterList({
  where,
  enabled,
  filter,
  shownPath,
  checks,
  onOpen,
}: {
  where: string;
  /** Reads the file list; off while the sidebar is hidden or behind another tab. */
  enabled: boolean;
  filter: string;
  /** The file in front, marked in the list. */
  shownPath: string | null;
  checks: ChecksController;
  /** `clicks` is 1 for a single click, 2 for a double one. */
  onOpen: (path: string, clicks: number) => void;
}) {
  const poll = usePoll();
  const files = useQuery({
    queryKey: ["project-files", where],
    queryFn: () => api.projectFiles(where),
    refetchInterval: poll(5000),
    enabled,
    staleTime: 0,
  });
  const matches = (files.data ?? []).filter((path) =>
    path.toLowerCase().includes(filter.toLowerCase()),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 28,
    overscan: 12,
  });
  return (
    <div className="project-file-scroll" ref={scroller}>
      {files.error && <ErrorBox error={files.error} />}
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((row) => {
          const path = matches[row.index];
          const slash = path.lastIndexOf("/");
          const errors = checks.state?.files[path]?.errors;
          return (
            <button
              key={path}
              className={path === shownPath ? "selected" : ""}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
              title={path}
              onClick={(e) => onOpen(path, e.detail)}
            >
              <FileCode2 size={14} />
              <span>
                <strong>{path.slice(slash + 1)}</strong>
                {slash > 0 && <small>{path.slice(0, slash)}</small>}
              </span>
              {errors ? <b className="file-errors">{errors}</b> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
