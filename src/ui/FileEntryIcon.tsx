import { useInsertionEffect, type CSSProperties } from "react";
import { Folder } from "lucide-react";
import { ensureFileIconSprite, fileIcon } from "../lib/file-icons";
import "./file-link.css";

export function FileEntryIcon({
  path,
  directory,
}: {
  path: string;
  directory: boolean;
}) {
  useInsertionEffect(ensureFileIconSprite, []);
  if (directory) return <Folder className="file-entry-icon" aria-hidden />;
  const icon = fileIcon(path);
  return (
    <svg
      aria-hidden
      className="file-entry-icon"
      viewBox="0 0 16 16"
      style={
        {
          "--file-icon-light": icon.colors[0],
          "--file-icon-dark": icon.colors[1],
        } as CSSProperties
      }
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
