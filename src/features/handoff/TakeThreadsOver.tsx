import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { PhonePairing, PhoneRemoteState } from "../../../shared/remote";
import { api } from "../../lib/api";
import { useCopy } from "../../lib/useCopy";
import { useNow } from "../../lib/useNow";
import { Switch } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { DeviceIcon } from "./DeviceIcon";
import { usePhoneRemote } from "./usePhoneRemote";
import "./computers.css";

function acceptHint(data?: PhoneRemoteState) {
  if (!data) return "Checking…";
  if (data.error) return data.error;
  if (data.listening)
    return `Other computers and phones on your tailnet reach Relay at ${data.hosts[0]}.`;
  if (data.enabled)
    return "Waiting for Tailscale on this computer; nothing reaches Relay until it's back.";
  if (data.tailnet.status !== "connected")
    return "Needs Tailscale on this computer first.";
  return "Uses the same Tailscale connection as phone access.";
}

/**
 * The computer that stays on: the switch it shares with phone access, a
 * one-time link for the other computer, and the computers that paired.
 */
export function TakeThreadsOver() {
  const qc = useQueryClient();
  const state = usePhoneRemote();
  const [pairing, setPairing] = useState<PhonePairing>();
  const [switching, setSwitching] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [copied, copy] = useCopy();
  const now = useNow(15_000);
  const data = state.data;
  const computers = data?.devices.filter((d) => d.kind === "computer") ?? [];
  const showing = pairing && pairing.expiresAt > now ? pairing : undefined;
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    void action()
      .then(() => qc.invalidateQueries({ queryKey: ["phone-remote"] }))
      .catch(setError)
      .finally(() => {
        setBusy(false);
        setSwitching(undefined);
      });
  };
  const newLink = () => run(async () => setPairing(await api.phonePairing()));
  return (
    <>
      <div className="settings-card cm-card">
        <div className="cm-row">
          <div className="cm-row-text">
            <b>Accept threads from other computers</b>
            <small>{acceptHint(data)}</small>
          </div>
          <Switch
            label="Accept threads from other computers"
            checked={switching ?? !!data?.enabled}
            disabled={
              !data || (!data.enabled && data.tailnet.status !== "connected")
            }
            onChange={(enabled) => {
              setSwitching(enabled);
              run(async () => {
                setPairing(undefined);
                await api.setPhoneRemote(enabled);
              });
            }}
          />
        </div>
        {data?.listening && (
          <div className="cm-row cm-link-row">
            {showing ? (
              <>
                <div className="cm-link">
                  <input
                    aria-label="This computer's pairing link"
                    readOnly
                    spellCheck={false}
                    value={showing.url}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button onClick={() => copy(showing.url)}>
                    {copied ? (
                      <Check size={14} aria-hidden />
                    ) : (
                      <Copy size={14} aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    className="cm-icon-button"
                    aria-label="New link"
                    title="New link"
                    disabled={busy}
                    onClick={newLink}
                  >
                    <RefreshCw size={14} aria-hidden />
                  </button>
                </div>
                <small className="cm-link-note">
                  Paste it on the other computer, under Add a computer. It works
                  once, for the next{" "}
                  {Math.max(1, Math.ceil((showing.expiresAt - now) / 60000))}{" "}
                  min.
                </small>
              </>
            ) : (
              <>
                <div className="cm-row-text">
                  <b>Pairing link</b>
                  <small>
                    A one-time link for the computer you hand threads from.
                  </small>
                </div>
                <button disabled={busy} onClick={newLink}>
                  Show pairing link
                </button>
              </>
            )}
          </div>
        )}
        {data?.listening &&
          computers.map((d) => (
            <div key={d.id} className="cm-row">
              <span className={`cm-card-icon small ${d.online ? "on" : ""}`}>
                <DeviceIcon name={d.name} size={16} />
              </span>
              <div className="cm-row-text">
                <b>{d.name}</b>
                <small>
                  <i className={`cm-dot ${d.online ? "on" : ""}`} />
                  {d.online ? "Connected" : "Offline"} · can hand threads to
                  this computer
                </small>
              </div>
              <button
                className="cm-text-button quiet"
                aria-label={`Remove ${d.name}`}
                disabled={busy}
                onClick={() => run(() => api.revokePhone(d.id))}
              >
                Remove
              </button>
            </div>
          ))}
      </div>
      {!!(error || state.error) && <ErrorBox error={error || state.error} />}
    </>
  );
}
