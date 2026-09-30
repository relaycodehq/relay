import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PairedComputer } from "../../shared/handoff";
import type { PhonePairing } from "../../shared/remote";
import { api } from "../lib/api";
import { useCopy } from "../lib/useCopy";
import "./handoff.css";
import { useNow } from "../lib/useNow";
import { ErrorBox, relativeDate } from "./ui";
import { TailscaleRow } from "./PhoneRemoteSettings";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "./SettingsCard";

/**
 * Computers this one hands threads to: paste the pairing link another
 * computer shows, and they stay connected over Tailscale from then on.
 */
export function HandoffComputersSettings() {
  const qc = useQueryClient();
  const computers = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    refetchInterval: 3000,
  });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = (action: () => Promise<PairedComputer[]>) => {
    setBusy(true);
    setError(undefined);
    void action()
      .then((list) => qc.setQueryData(["paired-computers"], list))
      .catch(setError)
      .finally(() => setBusy(false));
  };
  return (
    <>
      <SettingsCard>
        {computers.data?.map((c) => (
          <SettingsRow key={c.id} label={c.name} hint={computerHint(c)}>
            <button
              aria-label={`Forget ${c.name}`}
              disabled={busy}
              onClick={() => run(() => api.forgetComputer(c.id))}
            >
              Forget
            </button>
          </SettingsRow>
        ))}
        <SettingsRow
          label={
            computers.data?.length ? "Pair another computer" : "Pair a computer"
          }
          hint="On the other computer, open Settings → Computers, show its pairing link, and paste it here."
        >
          <input
            aria-label="Pairing link"
            placeholder="relay-remote://pair?…"
            spellCheck={false}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !link.trim()}
            onClick={() =>
              run(async () => {
                const list = await api.pairComputer(link);
                setLink("");
                return list;
              })
            }
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
        </SettingsRow>
        <SettingsFooter note="Both computers need Relay and Tailscale. A thread moves with its worktree, so the other computer needs its own clone of the project.">
          {null}
        </SettingsFooter>
      </SettingsCard>
      {!!(error || computers.error) && (
        <ErrorBox error={error || computers.error} />
      )}
    </>
  );
}

function computerHint(c: PairedComputer) {
  if (c.status === "online") return "Connected";
  if (c.status === "connecting") return "Connecting…";
  if (c.status === "denied")
    return `${c.detail ?? "It no longer accepts this computer."} Pair again.`;
  return c.detail ? `Offline · ${c.detail}` : "Offline";
}

/**
 * This computer taking threads over: the same Tailscale-only listener phones
 * use, a pairing link to paste on the other computer, and the computers that
 * paired this way.
 */
export function AcceptComputersSettings() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    refetchInterval: 3000,
  });
  const [pairing, setPairing] = useState<PhonePairing>();
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<boolean>();
  const [error, setError] = useState<unknown>();
  const [copied, copy] = useCopy();
  const now = useNow(15000);
  const data = state.data;
  const tailnet = data?.tailnet;
  const computers = data?.devices.filter((d) => d.kind === "computer") ?? [];
  const showing = pairing && pairing.expiresAt > now;
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
  return (
    <>
      <SettingsCard>
        <TailscaleRow tailnet={tailnet} />
        <SettingsRow
          label="Accept connections"
          hint={
            data?.listening
              ? `Other computers and phones on your tailnet reach Relay at ${data.hosts[0]}. Shared with phone access.`
              : "Shared with phone access: the same switch lets paired phones in."
          }
        >
          <Switch
            label="Accept connections"
            checked={switching ?? !!data?.enabled}
            disabled={
              !data || (!data.enabled && tailnet?.status !== "connected")
            }
            onChange={(enabled) => {
              setSwitching(enabled);
              run(async () => {
                setPairing(undefined);
                await api.setPhoneRemote(enabled);
              });
            }}
          />
        </SettingsRow>
        {data?.listening && (
          <SettingsRow
            label="Pairing link"
            hint={
              showing
                ? `Paste it under “Pair a computer” on the other one. It works once and expires in ${Math.max(1, Math.ceil((pairing.expiresAt - now) / 60000))} min.`
                : "Shows a one-time link that pins this computer's key, so the other one only ever talks to this Relay, encrypted."
            }
            below={
              showing && (
                <input
                  className="handoff-pairing-link"
                  aria-label="This computer's pairing link"
                  readOnly
                  value={pairing.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )
            }
          >
            {showing && (
              <button onClick={() => copy(pairing.url)}>
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            <button
              className={showing ? undefined : "primary"}
              disabled={busy}
              onClick={() =>
                run(async () => setPairing(await api.phonePairing()))
              }
            >
              {showing ? "New link" : "Show pairing link"}
            </button>
          </SettingsRow>
        )}
        {data?.listening &&
          computers.map((d) => (
            <SettingsRow
              key={d.id}
              label={d.name}
              hint={
                d.online
                  ? "Connected now; it can hand threads to this computer"
                  : d.lastSeen
                    ? `Last seen ${relativeDate(new Date(d.lastSeen).toISOString())}`
                    : "Paired"
              }
            >
              <button
                aria-label={`Remove ${d.name}`}
                disabled={busy}
                onClick={() => run(() => api.revokePhone(d.id))}
              >
                Remove
              </button>
            </SettingsRow>
          ))}
      </SettingsCard>
      {!!(error || state.error) && <ErrorBox error={error || state.error} />}
    </>
  );
}
