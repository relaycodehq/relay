import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { builtInMemes, memeAgents, memeSetupAgent } from "../../../shared/memes";
import { api } from "../../lib/api";
import { useAgentAccounts } from "../accounts/agent-accounts";
import { MemePicture } from "./MemePicture";
import type { MemePickerState } from "./useMemePicker";
import "./memes.css";

const HEIGHT = 200;
/** The offer to set memes up is shorter, so it fits above in less room. */
const OFFER_HEIGHT = 190;

function SetUpOffer({ picker }: { picker: MemePickerState }) {
  const accounts = useAgentAccounts();
  const agent = memeAgents[memeSetupAgent(accounts)];
  return (
    <div className="meme-offer">
      <strong>You can answer with memes</strong>
      <p>
        Like <em>Dew it</em>, <em>Perhaps</em> or <em>Hello there</em>. You see
        the picture; the agent gets one line of text with what it means.
      </p>
      <p className="muted">
        Setting up opens a scratch thread where {agent.label} downloads{" "}
        {builtInMemes.length} reaction memes, on low effort.{" "}
        {agent.provider === "codex"
          ? "That costs about a cent."
          : "It comes out of your Claude plan's usage limits."}
      </p>
      <div className="meme-offer-actions">
        <button type="button" className="primary" onClick={picker.setUp}>
          Set up memes
        </button>
        <button type="button" onClick={picker.dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

function Strip({ picker }: { picker: MemePickerState }) {
  const { items, active, state } = picker;
  const current = items[active];
  const missing = state?.memes.filter((m) => !m.url).length ?? 0;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    row.current
      ?.querySelector(`#${CSS.escape(`${picker.id}-${active}`)}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, picker.id]);
  return (
    <>
      <div className="meme-picker-head" aria-live="polite">
        {current ? (
          <>
            <strong>{current.name}</strong>
            <span title="What the agent gets instead of the picture">
              {current.meaning}
            </span>
          </>
        ) : (
          <span>
            {state?.memes.some((m) => m.url)
              ? `No meme matches "${picker.query.trim()}".`
              : "No meme pictures yet."}
          </span>
        )}
      </div>
      {!!items.length && (
        <div
          ref={row}
          className="meme-row"
          role="listbox"
          id={picker.id}
          aria-label="Memes"
          aria-orientation="horizontal"
          // A wheel that only scrolls up and down moves the row sideways.
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX))
              e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {items.map((m, i) => (
            <button
              key={m.id}
              type="button"
              id={`${picker.id}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={m.name}
              className={i === active ? "meme-cell selected" : "meme-cell"}
              onMouseMove={() => picker.setActive(i)}
              onClick={() => picker.pick(m)}
            >
              <MemePicture url={m.url!} name={m.name} play={i === active} />
            </button>
          ))}
        </div>
      )}
      <div className="meme-picker-foot">
        {missing > 0 && (
          <button type="button" onClick={picker.setUp}>
            Get {missing} {missing === 1 ? "picture" : "pictures"}
          </button>
        )}
        <button type="button" onClick={() => void api.openMemesList()}>
          Edit memes.json
        </button>
        <button type="button" onClick={() => void api.openMemesFolder()}>
          Open folder
        </button>
        <span className="meme-picker-keys">
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> pick
          </span>
          <span>
            <kbd>↵</kbd> send
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </span>
      </div>
    </>
  );
}

/** The meme picker, above the composer like its other menus. */
export function MemePicker({
  picker,
  input,
}: {
  picker: MemePickerState;
  input: RefObject<HTMLElement | null>;
}) {
  const [style, setStyle] = useState<CSSProperties>({});
  const { visible } = picker;
  const height = picker.mode === "setup" ? OFFER_HEIGHT : HEIGHT;
  useLayoutEffect(() => {
    if (!visible) return;
    function measure() {
      const form = (
        input.current?.closest("form") ?? input.current
      )?.getBoundingClientRect();
      if (!form) return;
      const width = Math.min(form.width, innerWidth - 24);
      const above = form.top > height + 16;
      setStyle({
        left: Math.max(12, Math.min(form.left, innerWidth - width - 12)),
        width,
        ...(above
          ? { bottom: innerHeight - form.top + 6 }
          : { top: form.bottom + 6 }),
        maxHeight: above
          ? Math.min(HEIGHT, form.top - 20)
          : Math.min(HEIGHT, innerHeight - form.bottom - 18),
      });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, input, height]);
  if (!visible) return null;
  return createPortal(
    <div
      className="meme-picker"
      style={style}
      // Keeps focus in the composer, whose blur would close the picker.
      onMouseDown={(e) => e.preventDefault()}
    >
      {picker.mode === "loading" ? (
        <p className="meme-picker-head">Loading memes…</p>
      ) : picker.mode === "setup" ? (
        <SetUpOffer picker={picker} />
      ) : (
        <Strip picker={picker} />
      )}
    </div>,
    document.body,
  );
}
