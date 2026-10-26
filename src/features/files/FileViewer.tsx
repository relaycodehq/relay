import {
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2 } from "lucide-react";
import { api } from "../../lib/api";
import { ErrorBox, Loading } from "../../ui/ui";
import type { WorkingChange } from "../../../shared/working-tree";
import { FileBar, OtherFile } from "./FileViews";
import { OpenWithButton } from "./OpenWithButton";
import { MediaFile } from "./MediaFile";
import { usePoll } from "../../lib/poll";
const TextFile = lazy(() => import("../editor/TextFile"));

type EditorProps = Omit<
  ComponentProps<typeof TextFile>,
  "path" | "shownPath" | "lead" | "inline" | "actions"
>;

/** File kind, metadata polling and viewer dispatch are the same inside and outside a project. */
export function FileViewer({
  active,
  where,
  path,
  shownPath,
  lead,
  editor,
  change,
}: {
  active: boolean;
  where: string;
  path: string;
  shownPath?: string;
  lead?: ReactNode;
  /** Undefined until the workspace's editor revision is available. */
  editor?: EditorProps;
  /** The file's uncommitted change, which a picture or video can show. */
  change?: WorkingChange;
}) {
  const poll = usePoll();
  const info = useQuery({
    queryKey: ["project-file-info", where, path],
    queryFn: () => api.projectFileInfo(where, path),
    enabled: active,
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => poll(q.state.data?.kind === "text" ? false : 3000),
  });
  const [actionError, setActionError] = useState<unknown>();
  if (info.error)
    return (
      <div className="files-main">
        <div className="empty project-editor-empty">
          <FileCode2 size={28} />
          <h2>Can’t open this file</h2>
          <ErrorBox error={info.error} />
        </div>
        <FileBar lead={lead} path={shownPath ?? path} />
      </div>
    );
  if (!info.data) return <Loading text="Opening…" />;
  const media = { active, where, info: info.data, lead, shownPath };
  if (info.data.kind === "image" || info.data.kind === "video")
    return <MediaFile {...media} change={change} opened={editor?.reveal} />;
  if (info.data.kind === "other") return <OtherFile {...media} />;
  if (!editor) return <Loading text="Opening editor…" />;
  return (
    <div className="files-main">
      {!!actionError && <ErrorBox error={actionError} />}
      <Suspense fallback={<Loading text="Opening editor…" />}>
        <TextFile
          {...editor}
          path={path}
          shownPath={shownPath}
          inline
          lead={lead}
          actions={
            <OpenWithButton
              where={where}
              path={path}
              external
              onError={setActionError}
            />
          }
        />
      </Suspense>
    </div>
  );
}
