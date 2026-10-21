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
import {
  FileBar,
  ImageFile,
  OtherFile,
  RevealButtons,
  VideoFile,
} from "./FileViews";
const LocalFileEditor = lazy(() => import("./editor/LocalFileEditor"));

type EditorProps = Omit<
  ComponentProps<typeof LocalFileEditor>,
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
  editorKey,
}: {
  active: boolean;
  where: string;
  path: string;
  shownPath?: string;
  lead?: ReactNode;
  /** Undefined until the workspace's editor revision is available. */
  editor?: EditorProps;
  editorKey: string;
}) {
  const info = useQuery({
    queryKey: ["project-file-info", where, path],
    queryFn: () => api.projectFileInfo(where, path),
    enabled: active,
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => (q.state.data?.kind === "text" ? false : 3000),
  });
  const [actionError, setActionError] = useState<unknown>();
  if (info.error)
    return (
      <div className="files-main">
        <FileBar lead={lead} path={shownPath ?? path} />
        <div className="empty project-editor-empty">
          <FileCode2 size={28} />
          <h2>Can’t open this file</h2>
          <ErrorBox error={info.error} />
        </div>
      </div>
    );
  if (!info.data) return <Loading text="Opening…" />;
  const media = { active, where, info: info.data, lead, shownPath };
  if (info.data.kind === "image") return <ImageFile {...media} />;
  if (info.data.kind === "video") return <VideoFile {...media} />;
  if (info.data.kind === "other") return <OtherFile {...media} />;
  if (!editor) return <Loading text="Opening editor…" />;
  return (
    <div className="files-main">
      {!!actionError && <ErrorBox error={actionError} />}
      <Suspense fallback={<Loading text="Opening editor…" />}>
        <LocalFileEditor
          key={editorKey}
          {...editor}
          path={path}
          shownPath={shownPath}
          inline
          lead={lead}
          actions={
            <RevealButtons
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
