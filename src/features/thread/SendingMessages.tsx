import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { ChatMessage, ChatSummary } from "../../../shared/projects";
import { Message } from "./ProjectMessage";
import type { SendingMessage } from "./sending-messages";

const noop = () => {};

/** Sent messages the thread doesn't hold yet, dimmed where they'll land. */
export function SendingMessages({
  chat,
  sending,
  projectRoot,
  onOpenFile,
}: {
  chat: ChatSummary;
  sending: SendingMessage[];
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  return sending.map(({ input, at }) => {
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
            {chat.stopping ? "Sends once the agent has stopped…" : "Sending…"}
          </span>
        </div>
      </div>
    );
  });
}
