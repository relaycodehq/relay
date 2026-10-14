// The rhythm row's third chart: what's left on each account right now, in the
// page's own columns, and Codex's saved resets with a way to spend one.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../../../lib/api";
import { errorMessage } from "../../../lib/error-message";
import { HarnessMark } from "../usage-charts";
import { dayLabel } from "../format";
import {
  canRefill,
  expiryWords,
  firstToLapse,
  isLow,
  outcomeWords,
  resetCount,
  roomiest,
  tankWords,
  windowName,
  windowTitle,
  type RoomAccount,
  type RoomTank,
} from "./room";
import type { Room } from "./useRoom";
import "./room.css";

export function RoomLeft({ room }: { room: Room }) {
  const best = roomiest(room.accounts);
  const saving = room.accounts.filter((a) => a.resets);
  return (
    <div className="us-room">
      <h3>
        Room left now
        <button
          type="button"
          className="us-room-recheck"
          title="Check again"
          aria-label="Check limits again"
          disabled={room.checking}
          onClick={() => void room.recheck()}
        >
          <RefreshCw size={12} />
        </button>
      </h3>
      <div
        className="us-room-accounts"
        style={{
          gridTemplateColumns: `repeat(${room.accounts.length}, minmax(0, 1fr))`,
        }}
      >
        {room.accounts.map((a) => (
          <Tanks key={`${a.provider}:${a.id}`} account={a} lit={a === best} />
        ))}
      </div>
      {saving.length > 0 && (
        <div className="us-room-saved">
          {saving.map((a) => (
            <SavedRow key={`${a.provider}:${a.id}`} account={a} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One account's limits, full when nothing's used; the roomiest in the accent. */
function Tanks({ account: a, lit }: { account: RoomAccount; lit: boolean }) {
  const [hover, setHover] = useState<RoomTank | null>(null);
  const words = hover && tankWords(hover, Date.now());
  return (
    <div className="us-room-account" onMouseLeave={() => setHover(null)}>
      <div className="us-room-tanks">
        {a.tanks.map((t) => (
          <span
            key={t.window.kind}
            className={lit ? "us-room-tank on" : "us-room-tank"}
            role="img"
            aria-label={`${a.name}, ${windowTitle(t.window.periodMs)}: ${t.meter.leftPercent}% left`}
            onMouseEnter={() => setHover(t)}
          >
            <span style={{ transform: `scaleY(${t.meter.leftPercent / 100})` }} />
          </span>
        ))}
      </div>
      <div className="us-room-ticks">
        {a.tanks.map((t) => (
          <span key={t.window.kind}>{windowName(t.window.periodMs)}</span>
        ))}
      </div>
      <div className="us-room-name" title={a.name}>
        <HarnessMark id={a.provider} size={11} />
        <span>{a.name}</span>
      </div>
      {words && (
        <div className="us-tip us-room-tip" role="status">
          <strong>
            {a.name} · {words.title}
          </strong>
          <span>{words.left}</span>
          {words.end && <span>{words.end}</span>}
          {words.pace && <span>{words.pace}</span>}
        </div>
      )}
    </div>
  );
}

function SavedRow({ account: a, room }: { account: RoomAccount; room: Room }) {
  const resets = a.resets!;
  const expiry = expiryWords(resets);
  return (
    <div className="us-room-saved-row">
      <HarnessMark id={a.provider} size={11} />
      <span className="us-room-saved-text">
        <span>
          {a.name} · {resetCount(resets.count)}
        </span>
        {expiry && <small>{expiry}</small>}
      </span>
      {canRefill(a) && <Refill account={a} room={room} />}
    </div>
  );
}

/** "Refill": quiet while there's room, in the accent once the account is low. */
function Refill({ account: a, room }: { account: RoomAccount; room: Room }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Kept until Codex gives a clear answer: after an unclear failure, trying
  // again sends the same attempt, which can't spend a second reset.
  const [attempt, setAttempt] = useState<string | null>(null);
  const resets = a.resets!;
  const credit = firstToLapse(resets);
  const stays = resets.count - 1;
  const refill = async () => {
    const id = attempt ?? crypto.randomUUID();
    setAttempt(id);
    setBusy(true);
    setNote(null);
    try {
      const { outcome, usage } = await api.redeemCodexReset(
        a.id,
        credit?.id ?? null,
        id,
      );
      setAttempt(null);
      room.put(a.provider, a.id, usage);
      const words = outcomeWords(outcome);
      if (words) setNote(words);
      else setOpen(false);
    } catch (error) {
      setNote(
        `${errorMessage(error)} Trying again can’t spend a second reset.`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setNote(null);
      }}
    >
      <Popover.Trigger
        type="button"
        className="us-room-refill"
        data-low={isLow(a) || undefined}
      >
        <RotateCcw size={12} />
        Refill
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="us-room-positioner"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup
            className="us-room-ask"
            aria-label="Use a saved reset"
            aria-busy={busy || undefined}
          >
            <p>
              Refill {a.name} now? Its limits start fresh
              {stays > 0
                ? `, and ${resetCount(stays)} ${stays === 1 ? "stays" : "stay"}.`
                : "; it’s the last saved one."}
              {credit?.expiresAt != null && (
                <small>
                  Spends the one that runs out {dayLabel(credit.expiresAt)}.
                </small>
              )}
            </p>
            {note && (
              <p className="us-room-note" role="alert">
                {note}
              </p>
            )}
            <div className="us-room-ask-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void refill()}
              >
                {busy ? "Refilling…" : "Refill now"}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Not now
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
