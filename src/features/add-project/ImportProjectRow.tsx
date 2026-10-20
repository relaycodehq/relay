import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import type { ImportApp, ImportProject } from "../../../shared/project-import";
import { tildePath } from "../../../shared/projects";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";

export interface ImportChoice {
  folder?: string;
  chats?: string[];
}

/** A selected project's chats load on demand, rather than scanning every transcript on entry. */
export function ImportProjectRow({
  app,
  project,
  choice,
  includeChats,
  busy,
  onChoose,
}: {
  app: ImportApp;
  project: ImportProject;
  choice?: ImportChoice;
  includeChats: boolean;
  busy: boolean;
  onChoose: (next: ImportChoice | undefined) => void;
}) {
  const [folder, setFolder] = useState<string>();
  const [error, setError] = useState<unknown>();
  const chats = useQuery({
    queryKey: ["import-chats", app, project.key, folder],
    queryFn: () => api.importProjectChats(app, project.key, folder),
    enabled: !!choice && includeChats,
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (!choice || !chats.data || chats.isFetching || chats.isError) return;
    const available = new Set(
      chats.data.filter((c) => !c.chatId).map((c) => c.id),
    );
    const selected = choice.chats?.filter((id) => available.has(id));
    if (selected === undefined || selected.length !== choice.chats?.length)
      onChoose({ ...choice, chats: selected ?? [...available] });
  }, [choice, chats.data, chats.isFetching, chats.isError, onChoose]);
  async function locate() {
    try {
      const path = await api.chooseFolder(`Locate ${project.name}`);
      if (!path) return;
      const info = await api.inspectFolder(path);
      if (info.kind === "missing" || info.kind === "file")
        throw new Error("Choose an existing project folder.");
      const target = info.kind === "inside" ? info.root : info.path;
      setFolder(target);
      setError(undefined);
      onChoose({ folder: target });
    } catch (e) {
      setError(e);
    }
  }
  const missing = project.missing && !folder;
  return (
    <li className="import-project">
      <div className="import-project-head">
        <label>
          <input
            type="checkbox"
            aria-label={`Import ${project.name}`}
            checked={!!choice}
            disabled={busy || missing}
            onChange={(e) =>
              onChoose(e.target.checked ? { folder } : undefined)
            }
          />
          <span>
            <strong>{project.name}</strong>
            <small>
              <MiddleTruncate
                text={tildePath(folder ?? project.path)}
                kind="path"
              />
            </small>
          </span>
        </label>
        <span className="import-project-state">
          {missing
            ? "Folder missing"
            : project.projectId
              ? "Already in Relay"
              : folder
                ? "Folder located"
                : ""}
        </span>
        {project.missing && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void locate()}
          >
            <FolderOpen size={13} />
            {folder ? "Change folder" : "Locate folder…"}
          </button>
        )}
      </div>
      {!!error && <ErrorBox error={error} />}
      {choice && includeChats && (
        <div className="import-chats">
          {chats.isPending ? (
            <p role="status">Looking for saved chats…</p>
          ) : chats.isError ? (
            <>
              <ErrorBox error={chats.error} />
              <button
                type="button"
                className="text-button"
                onClick={() => void chats.refetch()}
              >
                Try again
              </button>
            </>
          ) : !chats.data?.length ? (
            <p>No readable chat history remains for this project.</p>
          ) : (
            <>
              <div className="import-chat-heading">
                <span>
                  {chats.data.length} saved{" "}
                  {chats.data.length === 1 ? "chat" : "chats"}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    onChoose({
                      ...choice,
                      chats: choice.chats?.length
                        ? []
                        : chats.data.filter((c) => !c.chatId).map((c) => c.id),
                    })
                  }
                >
                  {choice.chats?.length ? "Deselect chats" : "Select chats"}
                </button>
              </div>
              {chats.data.map((chat) => (
                <label className="import-chat" key={chat.id}>
                  <input
                    type="checkbox"
                    aria-label={`Import chat ${chat.title}`}
                    checked={!!chat.chatId || !!choice.chats?.includes(chat.id)}
                    disabled={busy || !!chat.chatId}
                    onChange={(e) =>
                      onChoose({
                        ...choice,
                        chats: e.target.checked
                          ? [...(choice.chats ?? []), chat.id]
                          : choice.chats?.filter((id) => id !== chat.id),
                      })
                    }
                  />
                  <span>
                    {chat.title}
                    <small>
                      {chat.chatId
                        ? "Already imported"
                        : `${chat.turns} ${chat.turns === 1 ? "turn" : "turns"}`}
                    </small>
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}
