import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HeldSend } from "../../../shared/handoff";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { ChatMessage, ChatSummary } from "../../../shared/projects";
import { clock } from "../../../shared/waiting";
import { api } from "../../lib/api";
import { chatKey } from "../../lib/chat-events";
import { Message } from "./ProjectMessage";

const noop = () => {};

/**
 * Messages sent while the computer a live thread is on was away: dimmed
 * where they'll land, with the choice to carry on here instead. Once it
 * carries on here, those that didn't go out wait until sent again.
 */
export function HeldSends({
  chat,
  held,
  projectRoot,
  onOpenFile,
}: {
  chat: ChatSummary;
  held: HeldSend[];
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const view = useQuery({
    queryKey: ["handoff-view", chat.id],
    queryFn: () => api.handoffView(chat.id),
    refetchInterval: 3000,
    enabled: !!chat.sentTo,
  });
  if (!held.length) return null;
  const computer = chat.sentTo?.computer;
  const online = view.data?.online ?? true;
  const act = (job: () => Promise<void>) => {
    setBusy(true);
    setFailed(undefined);
    job()
      .catch((e: unknown) =>
        setFailed(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: chatKey(chat.id) });
        void qc.invalidateQueries({ queryKey: ["project-chats"] });
      });
  };
  return held.map(({ input, at, error }) => {
    const message: ChatMessage = {
      id: input.id,
      role: "user",
      body: input.body,
      status: "complete",
      created: at,
      provider: input.provider,
      version: 1,
    };
    return (
      <div key={input.id} className="held-send">
        <Message
          message={message}
          chatId={chat.id}
          projectRoot={projectRoot}
          onReply={noop}
          onChanges={noop}
          onTurnDiff={noop}
          onOpenFile={onOpenFile}
          onRewind={async () => ({ conflicts: [] })}
        />
        <div className="held-send-line" role="status">
          <span>
            {failed ??
              (!computer
                ? error
                  ? `Couldn't send it here: ${error}`
                  : "Not sent yet"
                : error
                  ? `${computer} turned it down: ${error}`
                  : online
                    ? `Sending to ${computer}…`
                    : `Waiting for ${computer}`)}
          </span>
          {!computer && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.runThreadHere(chat.id))}
            >
              Send here
            </button>
          )}
          {computer && !online && !error && (
            <button
              type="button"
              disabled={busy}
              title={`Carry on here with the conversation; what ${computer} changed in the code stays there`}
              onClick={() => act(() => api.runThreadHere(chat.id))}
            >
              Run here instead
            </button>
          )}
          {(!computer || !online || error) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.dropHeldSend(chat.id, input.id))}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  });
}

/** Where a live thread carried on here without its computer. */
export const ranHereNote = (computer: string, since: number) =>
  `Back here · ${computer}'s code changes since ${clock(since)} stay there`;
