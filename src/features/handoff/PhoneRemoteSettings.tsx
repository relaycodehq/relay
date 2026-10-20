import { useNow } from "../../lib/useNow";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import {
  tailscaleAndroid,
  tailscaleDownload,
  type PhonePairing,
  type PhoneRemoteState,
  type PhoneTailnet,
} from "../../../shared/remote";
import { androidAppDownload } from "../../../shared/updates";
import { useCopy } from "../../lib/useCopy";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { relativeDate } from "../../lib/relative-date";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "../../ui/SettingsCard";
import { QrCode } from "./qr/QrCode";

/**
 * Phone access runs over Tailscale, and over the local network when that's
 * allowed, so Settings walks through it: this computer on Tailscale, the
 * switches, then the phone's Tailscale, the app and the pairing code. Once a
 * phone is paired the steps fold away.
 */
export function PhoneRemoteSettings() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    // Notices Tailscale coming up and phones coming and going while Settings is open.
    refetchInterval: 3000,
  });
  // `before`: phones paired when the code was made. A new one used the code up.
  const [pairing, setPairing] = useState<
    PhonePairing & { before: ReadonlySet<string> }
  >();
  const [busy, setBusy] = useState(false);
  // The switch flips at once; the state catches up when the server has.
  const [switching, setSwitching] = useState<boolean>();
  const [error, setError] = useState<unknown>();
  const [copied, copy] = useCopy();
  const [code, setCode] = useState<"tailscale" | "app">();
  const [another, setAnother] = useState(false);
  const now = useNow(15000, !!pairing);
  const data = state.data;
  const tailnet = data?.tailnet;
  // Computers that paired to hand threads over have their own list, under Computers.
  const phones = data?.devices.filter((d) => d.kind !== "computer") ?? [];
  const paired = phones.length;
  // Gone for good, not hidden, so removing a phone can't bring a used code back.
  const used = pairing && phones.some((d) => !pairing.before.has(d.id));
  useEffect(() => {
    if (used) setPairing(undefined);
  }, [used]);
  const showing = pairing && !used && pairing.expiresAt > now;
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
        <TailscaleRow tailnet={tailnet} lan={!!data?.lan} />
        <SettingsRow label="Allow phone connections" hint={switchHint(data)}>
          <Switch
            label="Allow phone connections"
            checked={switching ?? !!data?.enabled}
            disabled={!data}
            onChange={(enabled) => {
              setSwitching(enabled);
              run(async () => {
                setPairing(undefined);
                await api.setPhoneRemote(enabled);
              });
            }}
          />
        </SettingsRow>
        <SettingsRow label="Local network" hint={lanHint(data)}>
          <Switch
            label="Local network"
            checked={!!data?.lan}
            disabled={!data || busy}
            onChange={(lan) =>
              run(async () => {
                setPairing(undefined);
                await api.setPhoneRemoteLan(lan);
              })
            }
          />
        </SettingsRow>
        {steps && (
          <ol className="phone-setup" aria-label="Set up a phone">
            <Step
              n={1}
              done={!!phone}
              title={
                data.lan ? "Tailscale on your phone, optional" : "Tailscale on your phone"
              }
              hint={
                data.lan && !phone
                  ? "Not needed on the same Wi-Fi. With it the phone reaches Relay from anywhere."
                  : phoneHint(tailnet)
              }
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
                    {data.lan
                      ? " The phone uses the local network when it's on the same one, Tailscale when it isn't."
                      : " Relay listens on nothing else, so the Wi-Fi around you can't reach it."}
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
                        before: new Set(phones.map((d) => d.id)),
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
          phones.map((d) => (
            <SettingsRow
              key={d.id}
              label={d.name}
              hint={
                <>
                  {d.online
                    ? "Connected now"
                    : d.lastSeen
                      ? `Last seen ${relativeDate(new Date(d.lastSeen).toISOString())}`
                      : "Paired"}
                  <br />
                  {d.app
                    ? `Relay ${d.app.version}`
                    : "App version unknown until the phone runs a newer Relay"}
                </>
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

function TailscaleRow({
  tailnet,
  lan,
}: {
  tailnet?: PhoneTailnet;
  lan: boolean;
}) {
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
              : lan
                ? "Optional with the local network on: it lets phones reach Relay away from this network too. Install it here and sign in; Relay notices on its own."
                : "Phones reach Relay over Tailscale, a private network between your own devices, or on the local network once that's on. Install it here and sign in; Relay notices on its own."
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
  if (data.listening && data.hosts.length)
    return `${reach(data)} reach Relay, at ${data.hosts.join(", ")}, port ${data.port}.`;
  if (data.listening)
    return "Listening, but this computer isn't on a network right now.";
  if (data.enabled)
    return "Waiting for Tailscale on this computer. Turn on Local network to let phones connect on the same Wi-Fi.";
  return "Off. Nothing listens for phones.";
}

function reach(data: PhoneRemoteState) {
  const tailnet = data.tailnet?.status === "connected";
  if (!data.lan) return "Only devices on your tailnet";
  return tailnet ? "Phones on this network or your tailnet" : "Phones on this network";
}

function lanHint(data?: PhoneRemoteState) {
  if (!data?.lan)
    return "Let phones on the same Wi-Fi connect directly, without Tailscale.";
  return "Phones on the same Wi-Fi connect directly, and move over by themselves when one answers. Still encrypted to this computer's key: others on the network can reach the port but get nothing.";
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
