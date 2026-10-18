import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorOff, MonitorUp } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import "./handoff.css";

/**
 * A thread waiting on an agent that sets its project up on the computer it's
 * going to: the composer answers that agent meanwhile. The user can point it
 * at a clone there instead, or give up and start here.
 */
export function SetupLine({
  chat,
  onError,
}: {
  chat: ChatSummary;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [folder, setFolder] = useState("");
  const [missing, setMissing] = useState<string>();
  const view = useQuery({
    queryKey: ["handoff-view", chat.id],
    queryFn: () => api.handoffView(chat.id),
    refetchInterval: 3000,
  });
  const computer = chat.sentTo!.computer;
  const online = view.data?.online ?? true;
  const act = (job: () => Promise<void>) => {
    setBusy(true);
    job()
      .catch(onError)
      .finally(() => {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ["project-chats"] });
        void qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
      });
  };
  const choose = (e: FormEvent) => {
    e.preventDefault();
    const typed = folder.trim();
    if (!typed) return;
    act(async () => {
      const found = await api.setupFolder(chat.id, typed);
      if (found) setChoosing(false);
      setMissing(
        found ? undefined : `${typed} on ${computer} holds no clone of it`,
      );
    });
  };
  if (choosing)
    return (
      <form className="handoff-live setup-folder" onSubmit={choose}>
        <MonitorUp size={12} />
        <input
          autoFocus
          value={folder}
          disabled={busy}
          placeholder={`A folder on ${computer}, like ~/code/project`}
          aria-label={`The project's folder on ${computer}`}
          onChange={(e) => {
            setFolder(e.target.value);
            setMissing(undefined);
          }}
          onKeyDown={(e) => e.key === "Escape" && setChoosing(false)}
        />
        {missing && <span className="setup-missing">{missing}</span>}
        <span className="setup-actions">
          <button type="submit" disabled={busy || !folder.trim()}>
            Use it
          </button>
          <button type="button" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </span>
      </form>
    );
  return (
    <div className={`handoff-live ${online ? "" : "offline"}`} role="status">
      {online ? <MonitorUp size={12} /> : <MonitorOff size={12} />}
      <span>
        {online
          ? `Setting up ${computer} for this thread`
          : `${computer} is offline; its setup waits`}
      </span>
      <span className="setup-actions">
        <button
          type="button"
          disabled={busy || !online}
          title={`Point it at a clone ${computer} already has`}
          onClick={() => setChoosing(true)}
        >
          Choose a folder there…
        </button>
        <button
          type="button"
          disabled={busy}
          title="Drop the setup and carry on on this computer"
          onClick={() => act(() => api.startThreadHere(chat.id))}
        >
          Start here instead
        </button>
      </span>
    </div>
  );
}
