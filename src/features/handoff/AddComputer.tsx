import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardPaste } from "lucide-react";
import type { ComputersOverview } from "../../../shared/handoff";
import { tailscaleDownload } from "../../../shared/remote";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { usePhoneRemote } from "./usePhoneRemote";

/** Pairing from this side: Tailscale, the link on the other computer, then paste. */
export function AddComputer({ onPaired }: { onPaired: (id: string) => void }) {
  const qc = useQueryClient();
  const tailnet = usePhoneRemote().data?.tailnet;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const pair = async (link: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const before = new Set(
        qc
          .getQueryData<ComputersOverview>(["computers-overview"])
          ?.computers.map((c) => c.id),
      );
      const list = await api.pairComputer(link);
      setText("");
      await qc.invalidateQueries({ queryKey: ["computers-overview"] });
      void qc.invalidateQueries({ queryKey: ["paired-computers"] });
      const added = list.find((c) => !before.has(c.id)) ?? list.at(-1);
      if (added) onPaired(added.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const pasteAndPair = async () => {
    const clip = (await api.readClipboard()).trim();
    setText(clip);
    if (clip) await pair(clip);
  };
  const connected = tailnet?.status === "connected";
  return (
    <div className="settings-card cm-card">
      <ol className="cm-steps">
        <li className={connected ? "done" : undefined}>
          <span className="cm-step-mark">
            {connected ? <Check size={12} strokeWidth={3} /> : 1}
          </span>
          <div className="cm-grow">
            <b>Tailscale on both computers</b>
            <small>
              {!tailnet
                ? "Checking…"
                : connected
                  ? `This one is on your tailnet${tailnet.name ? ` as ${tailnet.name}` : ""}.`
                  : tailnet.status === "stopped"
                    ? "Installed here, but not connected. Open Tailscale and sign in."
                    : "Computers reach each other over Tailscale, a private network between your own devices."}
            </small>
          </div>
          {tailnet?.status === "missing" && (
            <button onClick={() => void api.openExternal(tailscaleDownload)}>
              Get Tailscale
            </button>
          )}
        </li>
        <li>
          <span className="cm-step-mark">2</span>
          <div>
            <b>On the computer that stays on</b>
            <small>
              Open Settings → Computers there, turn on{" "}
              <em>Accept threads from other computers</em> and copy its link.
            </small>
          </div>
        </li>
        <li>
          <span className="cm-step-mark">3</span>
          <div className="cm-grow">
            <b>Paste the link here</b>
            <small>
              It works once, and pins that computer's key so this one only ever
              talks to it.
            </small>
            <div className="cm-paste">
              <input
                aria-label="Pairing link"
                placeholder="relay-remote://pair?…"
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim()) void pair(text);
                }}
              />
              <button
                className={text.trim() ? "primary" : undefined}
                disabled={busy}
                onClick={() =>
                  void (text.trim() ? pair(text) : pasteAndPair()).catch(
                    setError,
                  )
                }
              >
                {!text.trim() && !busy && (
                  <ClipboardPaste size={14} aria-hidden />
                )}
                {busy ? "Pairing…" : text.trim() ? "Pair" : "Paste & pair"}
              </button>
            </div>
          </div>
        </li>
      </ol>
      {!!error && <ErrorBox error={error} />}
    </div>
  );
}
