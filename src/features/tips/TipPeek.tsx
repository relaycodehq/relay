import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContextMenu } from "@base-ui/react/context-menu";
import { EyeOff, X } from "lucide-react";
import type { ChatMessage } from "../../../shared/projects";
import { readAloudChoice } from "../../../shared/read-aloud";
import { shortcutIds, type ShortcutId } from "../../../shared/shortcuts";
import { api } from "../../lib/api";
import { useImportedExtensions } from "../../lib/imported-themes";
import { openSettings } from "../../lib/settings-page";
import { bindings, useShortcutLabel } from "../../lib/shortcuts";
import { usedKeys } from "../../lib/used";
import { ContextMenuItem } from "../../ui/ContextMenuItem";
import { useReadAloudState } from "../read-aloud/state";
import { Clip } from "./Clip";
import {
  setTipsShown,
  tipMemory,
  updateTipMemory,
  useTipMemory,
  useTipsShown,
} from "./tip-memory";
import {
  canPeek,
  isSnoozed,
  PEEK_AFTER,
  pickTip,
  recordDone,
  recordNoticed,
  recordPeek,
  recordSnooze,
} from "./tips";
import type { Tip, TipFacts } from "./tip-list";
import "./tips.css";

/** The first peek ever says hello before its tip. */
const INTRO_FOR = 8000;

/** Clip, at the right of a long live turn's thinking line, with one tip. */
export function TipPeek(props: { chatId: string; message: ChatMessage }) {
  return useTipsShown() ? <Peek {...props} /> : null;
}

function Peek({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const live = message.status === "streaming";
  const due = useDue(live, message.created + PEEK_AFTER);
  const facts = useTipFacts(due, message.provider);
  // Undefined until picked; null when nothing peeks over this turn.
  const [tip, setTip] = useState<Tip | null>();
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (tip !== undefined || !facts) return;
    const now = Date.now();
    const memory = tipMemory();
    const next = canPeek(memory, chatId, message.id, now)
      ? pickTip(memory, facts, now)
      : undefined;
    setTip(next ?? null);
    if (!next) return;
    if (!memory.introSeen) setIntro(true);
    updateTipMemory((m) => ({
      ...recordPeek(m, chatId, message.id, next.id, now),
      introSeen: true,
    }));
  }, [tip, facts, chatId, message.id]);

  const queries = useQueryClient();
  const [hover, setHover] = useState(false);
  const [waggle, setWaggle] = useState(0);
  const [said, setSaid] = useState<string>();
  const [gone, setGone] = useState<"sinking" | "gone">();
  const noticed = useRef(false);
  // A × on any Clip puts down the others still up, in threads kept open.
  const snoozed = isSnoozed(useTipMemory(), Date.now());

  useEffect(() => {
    if (!intro) return;
    setWaggle((w) => w + 1);
    const timer = setTimeout(() => setIntro(false), INTRO_FOR);
    return () => clearTimeout(timer);
  }, [intro]);
  function leave() {
    setGone("sinking");
    setTimeout(() => setGone("gone"), 300);
  }
  async function act(tip: Tip) {
    updateTipMemory((m) => recordDone(m, tip.id));
    if (tip.settings) {
      openSettings(tip.settings);
      leave();
      return;
    }
    if (tip.turnOn !== "watch") return;
    try {
      await api.saveWatchThreads("main");
      void queries.invalidateQueries({ queryKey: ["watch-threads"] });
      setSaid("Turned on");
      setTimeout(leave, 1600);
    } catch {
      setSaid("Didn't work, try Settings → Used by Relay");
    }
  }

  function hide() {
    updateTipMemory((m) => recordDone(m, tip!.id));
    leave();
  }
  function snooze() {
    updateTipMemory((m) => recordSnooze(m, Date.now()));
    leave();
  }

  if (!tip || gone === "gone" || !live || (snoozed && !gone)) return null;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className={`tip-peek${gone ? " gone" : ""}`}
        onPointerEnter={() => {
          setHover(true);
          if (noticed.current) return;
          noticed.current = true;
          updateTipMemory(recordNoticed);
        }}
        onPointerLeave={() => setHover(false)}
      >
        <span className="tip-say">
          {intro ? (
            <>
              <span className="tip-ask">
                Hi, I&apos;m Clip, with tips while agents work
              </span>
              <button
                type="button"
                className="tip-cta"
                onClick={() => setIntro(false)}
              >
                Got it
              </button>
            </>
          ) : said ? (
            <span className="tip-ask">{said}</span>
          ) : (
            <>
              <Ask text={tip.ask} />
              {tip.cta && (
                <button
                  type="button"
                  className="tip-cta"
                  onClick={() => void act(tip)}
                >
                  {tip.cta}
                </button>
              )}
              <button
                type="button"
                className="tip-dismiss"
                aria-label="Hide tips for today"
                title="Not today"
                onClick={snooze}
              >
                <X size={12} />
              </button>
            </>
          )}
        </span>
        <span className="tip-clip">
          <Clip up={hover} sly={hover} waggle={waggle} />
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="sb-menu-positioner">
          <ContextMenu.Popup className="sb-menu">
            <ContextMenuItem icon={<X size={13} />} onClick={hide}>
              Don&apos;t show this tip again
            </ContextMenuItem>
            <ContextMenuItem
              icon={<EyeOff size={13} />}
              onClick={() => setTipsShown(false)}
            >
              Turn off tips
            </ContextMenuItem>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The ask, with each `{shortcut-id}` drawn as its keys. */
function Ask({ text }: { text: string }) {
  return (
    <span className="tip-ask">
      {text
        .split(/\{([\w-]+)\}/)
        .map((part, i) =>
          i % 2 ? <Keys key={i} id={part as ShortcutId} /> : part,
        )}
    </span>
  );
}

function Keys({ id }: { id: ShortcutId }) {
  return <kbd className="tip-keys">{useShortcutLabel(id)}</kbd>;
}

/** True once the turn has run `at`, while it's live. */
function useDue(live: boolean, at: number) {
  const [due, setDue] = useState(() => Date.now() >= at);
  useEffect(() => {
    if (due || !live) return;
    const timer = setTimeout(() => setDue(true), at - Date.now());
    return () => clearTimeout(timer);
  }, [due, live, at]);
  return live && due;
}

/** Undefined until the settings tips depend on have answered; a failed one rules its tip out. */
function useTipFacts(
  enabled: boolean,
  provider: ChatMessage["provider"],
): TipFacts | undefined {
  const watch = useQuery({
    queryKey: ["watch-threads"],
    queryFn: () => api.watchThreads(),
    enabled,
  });
  const phone = useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    enabled,
  });
  const readAloud = useReadAloudState();
  const themes = useImportedExtensions();
  if (!enabled || watch.isPending || phone.isPending) return undefined;
  const devices = phone.data?.devices;
  return {
    provider,
    watchOff: watch.data === undefined ? undefined : watch.data === "off",
    readAloudMissing: readAloud
      ? readAloud.supported && !readAloudChoice(readAloud)
      : undefined,
    noPhone: devices && !devices.some((d) => d.kind !== "computer"),
    noComputer: devices && !devices.some((d) => d.kind === "computer"),
    noImportedTheme: themes.length === 0,
    used: usedKeys(),
    unbound: new Set(shortcutIds.filter((id) => !bindings(id).length)),
  };
}
