import type { ReactNode } from "react";

/** A file's folder in muted text and its name in bold, for the bar above its contents. */
export function EditorPath({
  path,
  title = path,
  children,
}: {
  path: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="editor-bar-path" title={title}>
      {path.includes("/") && (
        <span className="editor-bar-dir">
          <bdi dir="ltr">{path.slice(0, path.lastIndexOf("/") + 1)}</bdi>
        </span>
      )}
      <strong>{path.split("/").pop()}</strong>
      {children}
    </div>
  );
}
