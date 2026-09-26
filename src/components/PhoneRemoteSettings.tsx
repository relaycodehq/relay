import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { encode } from "uqr";
import type { PhonePairing } from "../../shared/remote";
import { api } from "../lib/api";
import { ErrorBox, relativeDate } from "./ui";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "./SettingsCard";

export function PhoneRemoteSettings() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    // Shows phones coming and going while Settings is open.
    refetchInterval: 3000,
  });
  // `before`: phones paired when the code was made; one more ends the code's view.
  const [pairing, setPairing] = useState<PhonePairing & { before: number }>();
  const [busy, setBusy] = useState(false);
  // The switch flips at once; the state catches up when the server has.
  const [switching, setSwitching] = useState<boolean>();
  const [error, setError] = useState<unknown>();
  const [copied, setCopied] = useState(false);
  const now = useNow(!!pairing);
  const data = state.data;
  const paired = data?.devices.length ?? 0;
  const showing =
    pairing && pairing.expiresAt > now && paired <= pairing.before;
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
      <SettingsCard className="phone-remote">
        <SettingsRow
          label="Allow phone connections"
          hint={
            !data
              ? "Checking…"
              : data.error
                ? data.error
                : data.listening
                  ? `Phones on this network reach Relay at ${data.hosts.join(", ") || "no network yet"}, port ${data.port}.`
                  : "Off. Nothing listens for phones."
          }
        >
          <Switch
            label="Allow phone connections"
            checked={switching ?? !!data?.enabled}
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
          <>
            {showing ? (
              <div className="phone-pairing">
                <QrCode text={pairing.url} />
                <div>
                  <p>
                    Open the Relay app on your phone and scan this code. It
                    works once and expires in{" "}
                    {Math.max(1, Math.ceil((pairing.expiresAt - now) / 60000))}{" "}
                    min.
                  </p>
                  <p className="setting-muted">
                    The code also pins this computer's key, so the phone only
                    ever talks to this Relay, encrypted.
                  </p>
                  <button
                    onClick={() =>
                      void api.writeClipboard(pairing.url).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                    }
                  >
                    {copied ? "Copied" : "Copy pairing link"}
                  </button>
                </div>
              </div>
            ) : null}
            {data.devices.map((d) => (
              <SettingsRow
                key={d.id}
                label={d.name}
                hint={
                  d.online
                    ? "Connected now"
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
            <SettingsFooter
              note={
                paired
                  ? "Removing a phone disconnects it right away."
                  : "Phones can read and send messages, answer the agent's questions and view diffs. They can't open terminals or change settings."
              }
            >
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    setPairing({
                      ...(await api.phonePairing()),
                      before: paired,
                    }),
                  )
                }
              >
                {showing ? "New code" : "Pair a phone"}
              </button>
            </SettingsFooter>
          </>
        )}
      </SettingsCard>
      {!!(error || state.error) && <ErrorBox error={error || state.error} />}
    </>
  );
}

function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { d, size: data.length };
  }, [text]);
  return (
    <svg
      className="phone-qr"
      role="img"
      aria-label="Pairing QR code"
      viewBox={`0 0 ${path.size} ${path.size}`}
      shapeRendering="crispEdges"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}
