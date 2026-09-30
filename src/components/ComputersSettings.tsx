import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ClipboardPaste,
  Copy,
  Laptop,
  MonitorUp,
  Plus,
  RefreshCw,
} from "lucide-react";
import type {
  AwayState,
  AwayThread,
  ComputersOverview,
  PairedComputer,
} from "../../shared/handoff";
import {
  tailscaleDownload,
  type PhonePairing,
  type PhoneRemoteState,
} from "../../shared/remote";
import { api } from "../lib/api";
import { useCopy } from "../lib/useCopy";
import { useNow } from "../lib/useNow";
import { DeviceIcon } from "./DeviceIcon";
import { Switch } from "./SettingsCard";
import { ErrorBox } from "./ui";
import "./computers.css";

type Computer = ComputersOverview["computers"][number];

const stateWord: Record<AwayState, string> = {
  sending: "on its way",
  working: "working",
  waiting: "waiting for you",
  finished: "finished",
  returning: "coming back",
  failed: "didn't arrive",
  unknown: "can't check while it's offline",
};

function ago(since: number, now: number) {
  const minutes = Math.max(0, Math.round((now - since) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function threadLine(t: AwayThread, now: number) {
  if (t.state === "failed") return t.error ?? stateWord.failed;
  if (t.state === "finished") {
    const when = ago(t.since, now);
    return when === "just now" ? "finished just now" : `finished ${when} ago`;
  }
  if (t.state === "working" || t.state === "waiting")
    return `${stateWord[t.state]} · ${ago(t.since, now)}`;
  return stateWord[t.state];
}

function computerLine(c: PairedComputer) {
  if (c.status === "online") return "Connected";
  if (c.status === "connecting") return "Connecting…";
  if (c.status === "denied")
    return "It no longer accepts this computer. Pair again.";
  return c.detail ? `Offline · ${c.detail}` : "Offline";
}

function summary(c: Computer) {
  if (c.status === "offline") return "Offline";
  if (c.status !== "online") return computerLine(c);
  if (!c.threads.length) return "Connected";
  return `Connected · ${c.threads.length} ${c.threads.length === 1 ? "thread" : "threads"}`;
}

/**
 * Settings → Computers: this computer, a wire out to each paired one with a
 * dot per thread over there, and the picked computer's threads below. The
 * last box pairs another one.
 */
export function ComputersMap({
  onOpenChat,
}: {
  onOpenChat?: (projectId: string, chatId: string) => void;
}) {
  const overview = useQuery({
    queryKey: ["computers-overview"],
    queryFn: () => api.computersOverview(),
    refetchInterval: 3000,
  });
  const [picked, setPicked] = useState<string>();
  const data = overview.data;
  const computers = data?.computers ?? [];
  const current =
    computers.find((c) => c.id === picked) ??
    (picked === "add" ? undefined : computers[0]);
  return (
    <>
      {data && (
        <ComputerMap
          self={data.name}
          computers={computers}
          picked={current?.id ?? "add"}
          onPick={setPicked}
        />
      )}
      {data && (
        <div className="cm-detail">
          {current ? (
            <ComputerCard
              key={current.id}
              computer={current}
              onOpenChat={onOpenChat}
              onForgot={() => setPicked(undefined)}
            />
          ) : (
            <AddComputer onPaired={setPicked} />
          )}
        </div>
      )}
      {!!overview.error && <ErrorBox error={overview.error} />}
    </>
  );
}

// Pixel geometry, shared by the boxes and the wires between them.
const W = 600,
  selfW = 168,
  nodeW = 214,
  nodeH = 62,
  addH = 42,
  gap = 12,
  pad = 22;

function ComputerMap({
  self,
  computers,
  picked,
  onPick,
}: {
  self: string;
  computers: Computer[];
  picked: string;
  onPick: (id: string) => void;
}) {
  const [hover, setHover] = useState<string>();
  const rows = [
    ...computers.map((c) => ({ id: c.id, h: nodeH, c })),
    { id: "add", h: addH, c: undefined },
  ];
  const tops: number[] = [];
  let y = pad;
  for (const r of rows) {
    tops.push(y);
    y += r.h + gap;
  }
  const height = Math.max(y - gap + pad, nodeH + pad * 2);
  const selfY = height / 2;
  const x0 = selfW,
    x1 = W - nodeW;
  const mid = (i: number) => tops[i]! + rows[i]!.h / 2;
  const bend = (x1 - x0) * 0.55;
  const wire = (to: number) =>
    `M ${x0} ${selfY} C ${x0 + bend} ${selfY}, ${x1 - bend} ${to}, ${x1} ${to}`;
  /** A point on the wire to `to`, `t` of the way along. */
  const at = (to: number, t: number) => {
    const u = 1 - t;
    const b = (p: number[]) =>
      u * u * u * p[0]! +
      3 * u * u * t * p[1]! +
      3 * u * t * t * p[2]! +
      t * t * t * p[3]!;
    return {
      x: b([x0, x0 + bend, x1 - bend, x1]),
      y: b([selfY, selfY, to, to]),
    };
  };
  return (
    <div className="cm-map" role="group" aria-label="Your computers">
      <div className="cm-canvas" style={{ width: W, height }}>
        <svg className="cm-wires" width={W} height={height} aria-hidden>
          {rows.map(({ id, c }, i) => (
            <path
              key={id}
              d={wire(mid(i))}
              pathLength={1}
              className={`cm-wire ${c ? (c.status === "online" ? "on" : "off") : "add"} ${picked === id || hover === id ? "lit" : ""}`}
              style={{ "--i": i } as CSSProperties}
            />
          ))}
          {rows.map(({ c }, i) =>
            c?.threads.map((t, j) => {
              const p = at(mid(i), (j + 1) / (c.threads.length + 1));
              return (
                <circle
                  key={t.chatId}
                  className={`cm-thread-dot ${t.state}`}
                  cx={p.x}
                  cy={p.y}
                  r={4.5}
                  style={{ "--i": i } as CSSProperties}
                >
                  <title>
                    {t.title} · {stateWord[t.state]}
                  </title>
                </circle>
              );
            }),
          )}
        </svg>
        <div
          className="cm-node self"
          style={{
            left: 0,
            top: selfY - nodeH / 2,
            width: selfW,
            height: nodeH,
          }}
        >
          <span className="cm-tile">
            <Laptop size={20} strokeWidth={1.7} aria-hidden />
          </span>
          <span className="cm-node-text">
            <b>{self}</b>
            <small>This computer</small>
          </span>
        </div>
        {rows.map(({ id, h, c }, i) => {
          const props = {
            type: "button" as const,
            style: {
              left: x1,
              top: tops[i],
              width: nodeW,
              height: h,
              "--i": i,
            } as CSSProperties,
            "aria-pressed": picked === id,
            onClick: () => onPick(id),
            onMouseEnter: () => setHover(id),
            onMouseLeave: () => setHover(undefined),
          };
          return c ? (
            <button
              key={id}
              className={`cm-node ${c.status === "online" ? "on" : "off"} ${picked === id ? "picked" : ""}`}
              {...props}
            >
              <span className="cm-tile">
                <DeviceIcon name={c.name} />
              </span>
              <span className="cm-node-text">
                <b>{c.name}</b>
                <small>
                  <i
                    className={`cm-dot ${c.status === "online" ? "on" : ""}`}
                  />
                  {summary(c)}
                </small>
              </span>
            </button>
          ) : (
            <button
              key={id}
              className={`cm-node add ${picked === id ? "picked" : ""}`}
              {...props}
            >
              <Plus size={15} strokeWidth={2} aria-hidden />
              Add a computer
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComputerCard({
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
            {c.address && online && (
              <>
                <span className="cm-sep">·</span>
                <span className="cm-mono">{c.address}</span>
              </>
            )}
          </small>
        </div>
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
                  <em className={t.state}>{threadLine(t, now)}</em>
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
                t.state === "finished") && (
                <button
                  className="cm-text-button accent"
                  disabled={!online || !!busy}
                  title={
                    online
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
            className="cm-text-button quiet"
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

function usePhoneRemote() {
  return useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    refetchInterval: 3000,
  });
}

/** Pairing from this side: Tailscale, the link on the other computer, then paste. */
function AddComputer({ onPaired }: { onPaired: (id: string) => void }) {
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
