import { Popover } from "@base-ui/react/popover";
import { FolderSymlink, Plus, Settings2, X } from "lucide-react";
import { linkName, tildePath } from "../../../shared/projects";
import { api } from "../../lib/api";
import { IconButton } from "../../ui/ui";
import type { ThreadLinks } from "./useThreadLinks";
import "./linked-folders.css";

/**
 * Beside the branch: how many folders the thread reaches, and which. With
 * `empty`, it shows (faintly) before anything is linked, as a way to link one.
 */
export function LinksControl({
  links: { links, link, linkToProject, unlink },
  empty,
  onProjectSettings,
  onError,
}: {
  links: ThreadLinks;
  empty?: boolean;
  onProjectSettings: () => void;
  onError: (error: unknown) => void;
}) {
  if (!links.length && !empty) return null;
  const count = links.length
    ? `${links.length} linked ${links.length === 1 ? "folder" : "folders"}`
    : "Link a folder";

  async function choose() {
    const path = await api.chooseFolder("Link a folder");
    if (!path) return;
    const problem = await link(path);
    if (problem) onError(new Error(problem));
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        className={`composer-branch-trigger linked-trigger${links.length ? "" : " linked-trigger-empty"}`}
        title={
          links.length
            ? "Folders the agent reaches beyond this project"
            : "Link a folder the agent can reach beyond this project"
        }
        aria-label={count}
      >
        <FolderSymlink size={13} />
        {!!links.length && <span>{links.length}</span>}
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
            {!links.length && (
              <p className="linked-thread-hint">
                The agent only reaches this project&rsquo;s folder.
              </p>
            )}
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
            {!!links.length && (
              <p className="linked-thread-hint">
                /add-dir links one to this thread.
              </p>
            )}
            <div className="sb-menu-separator" role="separator" />
            <Popover.Close
              className="sb-menu-item linked-thread-settings"
              onClick={() => void choose().catch(onError)}
            >
              <span className="sb-menu-label">
                <Plus size={13} />
                Link a folder…
              </span>
            </Popover.Close>
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
