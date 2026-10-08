import { Popover } from "@base-ui/react/popover";
import { FolderSymlink, Settings2, X } from "lucide-react";
import { linkName, tildePath } from "../../../shared/projects";
import { IconButton } from "../../ui/ui";
import type { ThreadLinks } from "./useThreadLinks";
import "./linked-folders.css";

/** Beside the branch: how many folders the thread reaches, and which. */
export function LinksControl({
  links: { links, linkToProject, unlink },
  onProjectSettings,
}: {
  links: ThreadLinks;
  onProjectSettings: () => void;
}) {
  if (!links.length) return null;
  const count = `${links.length} linked ${links.length === 1 ? "folder" : "folders"}`;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="composer-branch-trigger linked-trigger"
        title="Folders the agent reaches beyond this project"
        aria-label={count}
      >
        <FolderSymlink size={13} />
        <span>{links.length}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          align="start"
          side="top"
          sideOffset={6}
        >
          <Popover.Popup className="composer-select-popup linked-thread-popup">
            <div className="composer-menu-label">Linked folders</div>
            <ul>
              {links.map((l) => (
                <li key={l.path} className="linked-thread-row">
                  <FolderSymlink size={14} />
                  <div title={tildePath(l.path)}>
                    <strong>{linkName(l.path)}</strong>
                    <small>
                      {l.access === "read" ? "Read only" : "Read and write"} ·{" "}
                      {l.from === "project"
                        ? "from the project"
                        : "this thread"}
                    </small>
                  </div>
                  {l.from === "thread" && (
                    <>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void linkToProject(l.path)}
                      >
                        Link to project
                      </button>
                      <IconButton
                        label={`Unlink ${linkName(l.path)}`}
                        onClick={() => void unlink(l.path)}
                      >
                        <X size={13} />
                      </IconButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="linked-thread-hint">
              /add-dir links one to this thread.
            </p>
            <div className="sb-menu-separator" role="separator" />
            <Popover.Close
              className="sb-menu-item linked-thread-settings"
              onClick={onProjectSettings}
            >
              <span className="sb-menu-label">
                <Settings2 size={13} />
                Project settings
              </span>
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
