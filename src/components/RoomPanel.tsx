import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Pull } from "../../shared/types";
import type { QuestionTarget } from "../../shared/questions";
import { api } from "../lib/api";
import { useSendKey } from "../lib/send-key";
import { useRoomAgent } from "../lib/useRoomAgent";
import { useRoomCompose } from "../lib/useRoomCompose";
import { useRoomFeed } from "../lib/useRoomFeed";
import { useRoomPresence } from "../lib/useRoomPresence";
import type { SettingsCategory } from "./Settings";
import { ErrorBox, Loading } from "./ui";
import { PaneResizer } from "./PaneResizer";
import { RoomHeader, RoomPresence } from "./RoomHeader";
import { RoomMessages } from "./RoomMessages";
import { RoomComposer } from "./RoomComposer";
import { RoomAgentSettings } from "./RoomAgentSettings";
import { RoomPeople } from "./RoomPeople";
import { RoomAccessPrompt, RoomConnect } from "./RoomAccess";
import "./rooms.css";

type Props = {
  pull: Pull;
  accountId: string;
  path?: string;
  target: QuestionTarget | null;
  viewed: number;
  onClose: () => void;
  onSelect: (path: string) => void;
  onClearTarget: () => void;
  onLink: () => void;
  onAppSettings: (category?: SettingsCategory) => void;
};
/** A PR's shared room: a conversation with colleagues and their agents beside the review. */
export function RoomPanel({
  pull,
  accountId,
  path,
  target,
  viewed,
  onClose,
  onSelect,
  onClearTarget,
  onLink,
  onAppSettings,
}: Props) {
  const key = JSON.stringify([accountId, pull.owner, pull.name, pull.number]);
  const sendKey = useSendKey();
  const agent = useRoomAgent();
  const compose = useRoomCompose(
    pull,
    `relay-room-draft:${key}`,
    path,
    target,
    agent,
  );
  const { draft, setDraft, input } = compose;
  const [error, setError] = useState<unknown>(),
    [settings, setSettings] = useState(false),
    [people, setPeople] = useState(false),
    [generatedInvite, setGeneratedInvite] = useState(""),
    [showPresence, setShowPresence] = useState(false);
  const state = useQuery({
    queryKey: ["roomState", key],
    queryFn: () => api.roomState(pull),
    retry: false,
  });
  const connection = state.data?.connection,
    room = state.data?.room;
  const feed = useRoomFeed(pull, room?.id);
  const [sharePresence, setSharePresence] = useRoomPresence(
    pull,
    room?.id,
    path,
    viewed,
  );
  const others = connection
    ? feed.presence.filter((p) => p.userId !== connection.member.id)
    : [];
  const act = (task: () => Promise<unknown>) => {
    setError(undefined);
    void task().catch(setError);
  };
  return (
    <aside id="pr-room" className="room-panel" aria-label="PR room">
      <PaneResizer
        pane="room"
        label="Resize conversation"
        initial={460}
        min={340}
        max={760}
      />
      <RoomHeader
        pull={pull}
        connection={connection}
        others={others}
        networkError={feed.networkError}
        showPresence={showPresence}
        onTogglePresence={() => setShowPresence((v) => !v)}
        onPeople={() => setPeople(true)}
        onClose={onClose}
      />
      {state.isPending ? (
        <Loading text="Opening room…" />
      ) : state.error ? (
        <>
          <ErrorBox error={state.error} />
          <RoomAccessPrompt pull={pull} onReady={() => void state.refetch()} />
        </>
      ) : !connection ? (
        <RoomConnect
          pull={pull}
          onSettings={onAppSettings}
          onConnected={() => void state.refetch()}
          onInvited={async (code) => {
            await state.refetch();
            setGeneratedInvite(code);
            setPeople(true);
          }}
        />
      ) : (
        <>
          {showPresence && (
            <RoomPresence
              pull={pull}
              others={others}
              networkError={feed.networkError}
              share={sharePresence}
              onShare={setSharePresence}
              onSelect={onSelect}
            />
          )}
          <RoomMessages
            pull={pull}
            feed={feed}
            memberId={connection.member.id}
            onLoadEarlier={() => act(feed.loadEarlier)}
            onInvite={() => setPeople(true)}
            onSelect={onSelect}
            onReply={(m) => {
              setDraft((d) => ({ ...d, parentId: m.id, pending: undefined }));
              input.current?.focus();
            }}
            onCancel={(id) => act(() => api.roomCancel(pull, id))}
            onRetry={(m) => {
              const request = feed.messages.find((x) => x.id === m.requestId);
              if (request) {
                const { excerpt: _, ...context } = request.context;
                setDraft({
                  text: request.body,
                  parentId: request.parentId,
                  context: context.start ? context : undefined,
                });
                input.current?.focus();
              } else
                setError(
                  new Error(
                    "Load the original question above, then ask again.",
                  ),
                );
            }}
          />
          <RoomComposer
            pull={pull}
            path={path}
            compose={compose}
            agent={agent}
            parent={feed.messages.find((m) => m.id === draft.parentId)}
            memberName={connection.member.name}
            sendKey={sendKey}
            onSend={() =>
              void compose.send(setError, () => {
                onClearTarget();
                feed.followLatest();
              })
            }
            onClearTarget={onClearTarget}
            onLink={onLink}
            onSettings={() => setSettings(true)}
          />
          {!connection.persistent && (
            <p className="room-notice">
              Room login is available for this session only; secure credential
              storage is unavailable.
            </p>
          )}
          {compose.saveFailed && (
            <p className="room-notice">
              Draft could not be saved on this device. Keep the app open or copy
              your message.
            </p>
          )}
          {!!error && (
            <div className="room-error">
              <ErrorBox error={error} />
              <button onClick={() => setError(undefined)}>Dismiss</button>
              <button onClick={onLink}>Link local folder</button>
            </div>
          )}
          {settings && (
            <RoomAgentSettings
              agent={agent}
              onClose={() => setSettings(false)}
              onLink={onLink}
              onError={setError}
            />
          )}
          {people && (
            <RoomPeople
              pull={pull}
              state={state.data!}
              initialInvite={generatedInvite}
              onClose={() => {
                setPeople(false);
                setGeneratedInvite("");
              }}
              onDisconnect={() => {
                act(async () => {
                  await api.roomDisconnect(pull);
                  setPeople(false);
                  feed.clear();
                  await state.refetch();
                });
              }}
            />
          )}
        </>
      )}
    </aside>
  );
}
