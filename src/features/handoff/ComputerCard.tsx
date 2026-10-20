import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MonitorUp } from "lucide-react";
import { api } from "../../lib/api";
import { useNow } from "../../lib/useNow";
import { ErrorBox } from "../../ui/ui";
import { DeviceIcon } from "./DeviceIcon";
import { RelayVersion } from "./RelayVersion";
import {
  computerLine,
  reachable,
  threadLine,
  type Computer,
} from "./computer-status";
import { useWakeComputer } from "./usePairedComputers";

/** The picked computer: its link and Relay, its threads to bring back, and forgetting it. */
export function ComputerCard({
  computer: c,
  onOpenChat,
  onForgot,
}: {
  computer: Computer;
  onOpenChat?: (projectId: string, chatId: string) => void;
  onForgot: () => void;
}) {
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const online = c.status === "online";
  // Asleep, it wakes for whatever asks; viewing this card alone doesn't.
  const usable = reachable(c);
  const { waking, wake } = useWakeComputer(setError);
  const run = (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    void action()
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["computers-overview"] });
        void qc.invalidateQueries({ queryKey: ["paired-computers"] });
        void qc.invalidateQueries({ queryKey: ["project-chats"] });
      })
      .catch(setError)
      .finally(() => setBusy(undefined));
  };
  return (
    <div className="settings-card cm-card">
      <div className="cm-card-head">
        <span className={`cm-card-icon ${online ? "on" : ""}`}>
          <DeviceIcon name={c.name} />
        </span>
        <div className="cm-card-title">
          <b>{c.name}</b>
          <small>
            <i className={`cm-dot ${online ? "on" : ""}`} />
            {computerLine(c)}
            {c.address && usable && (
              <>
                <span className="cm-sep">·</span>
                <span className="cm-mono">{c.address}</span>
              </>
            )}
          </small>
        </div>
        {online && <RelayVersion computer={c} onError={setError} />}
        {c.stopped && (
          <div className="cm-version">
            <button
              className="cm-text-button accent"
              disabled={waking}
              onClick={() => void wake(c.id)}
            >
              {waking ? "Starting…" : "Reconnect"}
            </button>
          </div>
        )}
      </div>
      {c.threads.length ? (
        <ul className="cm-threads" aria-label={`Threads on ${c.name}`}>
          {c.threads.map((t) => (
            <li key={t.chatId}>
              <i className={`cm-dot ${t.state}`} />
              <div className="cm-thread-text">
                <span>{t.title}</span>
                <small>
                  {t.project}
                  <span className="cm-sep">·</span>
                  <em className={t.state}>{threadLine(t, now, c)}</em>
                </small>
              </div>
              {onOpenChat && (
                <button
                  className="cm-text-button"
                  onClick={() => onOpenChat(t.projectId, t.chatId)}
                >
                  Open
                </button>
              )}
              {(t.state === "working" ||
                t.state === "waiting" ||
                t.state === "finished" ||
                t.state === "stopped") && (
                <button
                  className="cm-text-button accent"
                  disabled={!usable || !!busy}
                  title={
                    usable
                      ? `Stop it on ${c.name} and carry on here`
                      : `${c.name} is offline`
                  }
                  onClick={() =>
                    run(t.chatId, () => api.bringBackThread(t.chatId))
                  }
                >
                  {busy === t.chatId ? "Bringing back…" : "Bring back"}
                </button>
              )}
              {t.retry && (
                <button
                  className="cm-text-button accent"
                  disabled={!usable || !!busy}
                  title={usable ? t.error : `${c.name} is offline`}
                  onClick={() =>
                    run(t.chatId, () =>
                      t.retry === "send"
                        ? api.retryHandoff(t.chatId)
                        : api.bringBackThread(t.chatId),
                    )
                  }
                >
                  {busy === t.chatId ? "Trying…" : "Try again"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="cm-nothing">
          <MonitorUp size={16} aria-hidden />
          <span>
            Nothing there right now. Hand a thread over from its header.
          </span>
        </div>
      )}
      <div className="cm-card-foot">
        {confirming ? (
          <>
            <span>
              {c.threads.length
                ? `Forget ${c.name}? Its threads there can't come back until you pair again.`
                : `Forget ${c.name}?`}
            </span>
            <button
              className="cm-text-button"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
            <button
              className="cm-text-button danger"
              disabled={!!busy}
              onClick={() =>
                run("forget", async () => {
                  await api.forgetComputer(c.id);
                  onForgot();
                })
              }
            >
              Forget
            </button>
          </>
        ) : (
          <button
            className="cm-text-button quiet forget"
            onClick={() => setConfirming(true)}
          >
            Forget this computer
          </button>
        )}
      </div>
      {!!error && <ErrorBox error={error} />}
    </div>
  );
}
