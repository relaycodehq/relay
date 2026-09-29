import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { encode } from "uqr";
import {
  tailscaleAndroid,
  tailscaleDownload,
  type PhonePairing,
  type PhoneRemoteState,
  type PhoneTailnet,
} from "../../shared/remote";
import { androidAppDownload } from "../../shared/updates";
import { useCopy } from "../lib/useCopy";
import { api } from "../lib/api";
import { ErrorBox, relativeDate } from "./ui";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "./SettingsCard";

/**
 * Phone access runs over Tailscale only, so Settings walks through it: this
 * computer on Tailscale, the switch, then the phone's Tailscale, the app and
 * the pairing code. Once a phone is paired the steps fold away.
 */
export function PhoneRemoteSettings() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    // Notices Tailscale coming up and phones coming and going while Settings is open.
    refetchInterval: 3000,
  });
  // `before`: phones paired when the code was made; one more ends the code's view.
  const [pairing, setPairing] = useState<PhonePairing & { before: number }>();
  const [busy, setBusy] = useState(false);
  // The switch flips at once; the state catches up when the server has.
  const [switching, setSwitching] = useState<boolean>();
  const [error, setError] = useState<unknown>();
  const [copied, copy] = useCopy();
  const [code, setCode] = useState<"tailscale" | "app">();
  const [another, setAnother] = useState(false);
  const now = useNow(!!pairing);
  const data = state.data;
  const tailnet = data?.tailnet;
  const paired = data?.devices.length ?? 0;
  const showing =
    pairing && pairing.expiresAt > now && paired <= pairing.before;
  useEffect(() => setAnother(false), [paired]);
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
  const toggle = (which: "tailscale" | "app") =>
    setCode((open) => (open === which ? undefined : which));
  const steps = data?.listening && (!paired || another || showing);
  const phone = tailnet?.phones?.find((p) => p.online);
  return (
    <>
      <SettingsCard className="phone-remote">
        <TailscaleRow tailnet={tailnet} />
        <SettingsRow label="Allow phone connections" hint={switchHint(data)}>
          <Switch
            label="Allow phone connections"
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
        {steps && (
          <ol className="phone-setup" aria-label="Set up a phone">
            <Step
              n={1}
              done={!!phone}
              title="Tailscale on your phone"
              hint={phoneHint(tailnet)}
              action={
                <button onClick={() => toggle("tailscale")}>
                  {code === "tailscale" ? "Hide code" : "Get Tailscale"}
                </button>
              }
            >
              {code === "tailscale" && (
                <CodePanel text={tailscaleAndroid} label="Tailscale QR code">
                  <p>
                    Scan with the phone's camera to get Tailscale from Google
                    Play, then sign in with the account this computer uses.
                  </p>
                  <p className="setting-muted">
                    The phone and this computer then share a private network.
                    Relay listens on nothing else, so the Wi-Fi around you can't
                    reach it.
                  </p>
                </CodePanel>
              )}
            </Step>
            <Step
              n={2}
              title="Relay on your phone"
              hint="The Android app from Relay's releases."
              action={
                <button onClick={() => toggle("app")}>
                  {code === "app" ? "Hide code" : "Get the app"}
                </button>
              }
            >
              {code === "app" && (
                <CodePanel text={androidAppDownload} label="Download QR code">
                  <p>
                    Scan with the phone's camera to download the newest Relay
                    app. Open it from the download, and allow installs from the
                    browser when Android asks; it asks only the first time.
                  </p>
                  <p className="setting-muted">
                    Later versions come from this computer, so the app stays in
                    step with it.
                  </p>
                </CodePanel>
              )}
            </Step>
            <Step
              n={3}
              title="Pair"
              hint="Scan the code from the Relay app on the phone."
              action={
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
                  {showing ? "New code" : "Show pairing code"}
                </button>
              }
            >
              {showing && (
                <CodePanel text={pairing.url} label="Pairing QR code">
                  <p>
                    Open Relay on the phone and scan this code. It works once
                    and expires in{" "}
                    {Math.max(1, Math.ceil((pairing.expiresAt - now) / 60000))}{" "}
                    min.
                  </p>
                  <p className="setting-muted">
                    The code also pins this computer's key, so the phone only
                    ever talks to this Relay, encrypted.
                  </p>
                  <button onClick={() => copy(pairing.url)}>
                    {copied ? "Copied" : "Copy pairing link"}
                  </button>
                </CodePanel>
              )}
            </Step>
          </ol>
        )}
        {data?.listening &&
          data.devices.map((d) => (
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
        {data?.listening && (
          <SettingsFooter
            note={
              paired
                ? "Removing a phone disconnects it right away."
                : "Phones can read and send messages, answer the agent's questions and view diffs. They can't open terminals or change settings."
            }
          >
            {another ? (
              <button onClick={() => setAnother(false)}>Hide steps</button>
            ) : (
              !steps && (
                <button onClick={() => setAnother(true)}>
                  Set up another phone
                </button>
              )
            )}
          </SettingsFooter>
        )}
      </SettingsCard>
      {!!(error || state.error) && <ErrorBox error={error || state.error} />}
    </>
  );
}

function TailscaleRow({ tailnet }: { tailnet?: PhoneTailnet }) {
  const connected = tailnet?.status === "connected";
  return (
    <SettingsRow
      label={
        <span className="phone-tailscale">
          {connected && <Check size={14} aria-hidden />}
          Tailscale on this computer
        </span>
      }
      hint={
        !tailnet
          ? "Checking…"
          : connected
            ? `On your tailnet${tailnet.name ? ` as ${tailnet.name}` : ""}, at ${tailnet.addresses[0]}.`
            : tailnet.status === "stopped"
              ? "Installed, but not connected. Open Tailscale and sign in; Relay notices on its own."
              : "Phones reach Relay only over Tailscale, a private network between your own devices. Install it here and sign in; Relay notices on its own."
      }
    >
      {tailnet?.status === "missing" && (
        <button
          className="primary"
          onClick={() => void api.openExternal(tailscaleDownload)}
        >
          Get Tailscale
        </button>
      )}
    </SettingsRow>
  );
}

function switchHint(data?: PhoneRemoteState) {
  if (!data) return "Checking…";
  if (data.error) return data.error;
  if (data.listening)
    return `Only devices on your tailnet reach Relay, at ${data.hosts[0]}, port ${data.port}.`;
  if (data.enabled)
    return "Waiting for Tailscale on this computer. Phones can't reach Relay until it's back.";
  // Optional: a main process from before Tailscale answers without it until Relay restarts.
  if (data.tailnet?.status !== "connected")
    return "Needs Tailscale on this computer first.";
  return "Off. Nothing listens for phones.";
}

function phoneHint(tailnet?: PhoneTailnet) {
  const phones = tailnet?.phones;
  const online = phones?.find((p) => p.online);
  if (online) return `${online.name} is on your tailnet.`;
  if (phones?.length)
    return `${phones[0]!.name} is on your tailnet but offline. Open Tailscale on it.`;
  return "Install Tailscale and sign in with the account this computer uses.";
}

function Step({
  n,
  done,
  title,
  hint,
  action,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  hint: string;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={done ? "phone-step done" : "phone-step"}>
      <span
        className="phone-step-mark"
        role="img"
        aria-label={done ? `Step ${n}, done` : `Step ${n}`}
      >
        {done ? <Check size={12} strokeWidth={3} /> : n}
      </span>
      <div className="settings-row-text">
        <span>{title}</span>
        <small>{hint}</small>
      </div>
      <div className="settings-row-control">{action}</div>
      {children && <div className="phone-step-below">{children}</div>}
    </li>
  );
}

function CodePanel({
  text,
  label,
  children,
}: {
  text: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="phone-pairing">
      <QrCode text={text} label={label} />
      <div>{children}</div>
    </div>
  );
}

function QrCode({ text, label }: { text: string; label: string }) {
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
      aria-label={label}
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
