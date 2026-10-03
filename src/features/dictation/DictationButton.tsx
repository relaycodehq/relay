import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { Check, Mic } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { dictationModelSize } from "../../../shared/dictation";
import { api } from "../../lib/api";
import {
  cancelDictation,
  clearDictationError,
  dictationModelState,
  dictationSnapshot,
  startDictation,
  stopDictation,
  useDictation,
  useDictationModel,
  type DictationTarget,
} from "./audio/session";
import {
  setDictationMicrophone,
  useDictationMicrophone,
  useMicrophones,
} from "./audio/microphones";
import { matchedCombo, useShortcutLabel } from "../../lib/shortcuts";
import type { KeyCombo } from "../../../shared/shortcuts";
import { DictationWave } from "./DictationWave";
import "./dictation.css";

/** Held longer than this, the key is push-to-talk and letting go finishes. */
const holdThreshold = 350;

interface Composer {
  owner: object;
  element: RefObject<HTMLElement | null>;
  focused: number;
  start(): void;
}

// Every mounted composer; the shortcut goes to the one holding focus, or the
// one used last.
const composers = new Set<Composer>();
let press: { at: number; combo: KeyCombo } | undefined;

function pick() {
  const active = document.activeElement;
  let best: Composer | undefined;
  for (const composer of composers) {
    if (active && composer.element.current?.contains(active)) return composer;
    if (!best || composer.focused > best.focused) best = composer;
  }
  return best;
}

function onKeyDown(e: KeyboardEvent) {
  const phase = dictationSnapshot().phase;
  if (e.key === "Escape" && phase !== "idle") {
    // Before the double-Escape that stops an agent sees it.
    e.preventDefault();
    e.stopImmediatePropagation();
    press = undefined;
    cancelDictation();
    return;
  }
  const combo = matchedCombo("dictate", e);
  if (!combo || e.isComposing) return;
  e.preventDefault();
  if (e.repeat) return;
  if (phase === "idle") {
    const composer = pick();
    if (!composer) return;
    press = { at: performance.now(), combo };
    composer.start();
  } else if (phase === "starting" || phase === "listening") {
    press = undefined;
    void stopDictation();
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (!press) return;
  const shortcut = press.combo;
  // macOS drops a key's keyup while ⌘ is down, so letting go of a modifier counts too.
  const released =
    e.code === shortcut.code ||
    (e.key === "Alt" && shortcut.alt) ||
    (e.key === "Control" && shortcut.ctrl) ||
    (e.key === "Meta" && shortcut.meta) ||
    (e.key === "Shift" && shortcut.shift);
  if (!released) return;
  const held = performance.now() - press.at;
  press = undefined;
  if (held >= holdThreshold) void stopDictation();
}

function onBlur() {
  // Held to talk and then switched away: the keyup will never come.
  if (press && performance.now() - press.at >= holdThreshold)
    void stopDictation();
  press = undefined;
}

function register(composer: Composer) {
  if (!composers.size) {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
  }
  composers.add(composer);
  return () => {
    composers.delete(composer);
    if (composers.size) return;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
  };
}

const megabytes = (bytes: number) => Math.round(bytes / 1e6);

/**
 * The composer's mic. Click or press the shortcut to dictate; while listening
 * it widens into the live waveform, and clicking that finishes.
 */
export function DictationButton({
  owner,
  target,
  composer,
  resetKey,
  disabled,
}: {
  /** Identifies this composer's dictation. */
  owner: object;
  target: () => DictationTarget | undefined;
  /** The composer, for focus-aware shortcut routing. */
  composer: RefObject<HTMLElement | null>;
  /** Dictation into a draft ends when the draft does. */
  resetKey: string;
  disabled?: boolean;
}) {
  const session = useDictation();
  const model = useDictationModel();
  const shortcut = useShortcutLabel("dictate");
  const [prompt, setPrompt] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const mine = session.owner === owner && session.phase !== "idle";
  const error = session.owner === owner ? session.error : undefined;
  // The waveform stays while the capsule shrinks back into the mic.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (mine) return setShown(true);
    const timer = setTimeout(() => setShown(false), 320);
    return () => clearTimeout(timer);
  }, [mine]);

  const start = useRef(() => {});
  start.current = () => {
    const into = target();
    if (!into || disabled) return;
    void startDictation(into, owner).then((ready) => {
      if (!ready) setPrompt(true);
    });
  };

  useEffect(() => {
    const entry: Composer = {
      owner,
      element: composer,
      focused: 0,
      start: () => start.current(),
    };
    const focus = () => (entry.focused = performance.now());
    const element = composer.current;
    element?.addEventListener("focusin", focus);
    const unregister = register(entry);
    return () => {
      element?.removeEventListener("focusin", focus);
      unregister();
    };
  }, [owner, composer]);

  useEffect(
    () => () => {
      const now = dictationSnapshot();
      if (now.owner === owner && now.phase !== "idle") cancelDictation();
    },
    [owner, resetKey],
  );

  useEffect(() => {
    if (error) setPrompt(true);
  }, [error]);
  const downloading = model.status === "downloading";

  if (model.status === "unsupported") return null;
  const progress =
    model.status === "downloading" ? model.received / model.total : undefined;
  const label = mine
    ? "Finish dictation"
    : model.status === "ready"
      ? `Dictate${shortcut && ` · ${shortcut}`}`
      : downloading
        ? "Downloading the speech model"
        : "Set up dictation";

  return (
    <Popover.Root
      open={prompt}
      onOpenChange={(open) => {
        setPrompt(open);
        if (!open) clearDictationError();
      }}
    >
      <MicrophoneMenu disabled={mine}>
        <button
          ref={button}
          type="button"
          className="composer-control dictation-mic"
          data-live={mine || undefined}
          data-shown={shown || undefined}
          data-downloading={downloading || undefined}
          aria-label={label}
          aria-pressed={mine}
          title={
            mine
              ? `Finish${shortcut && ` · ${shortcut}`} · Esc to discard`
              : model.status === "ready" && shortcut
                ? `Dictate · tap ${shortcut} to start and stop, or hold it to talk`
                : label
          }
          disabled={disabled && !mine}
          onPointerEnter={() => {
            if (model.status === "ready" && !mine) void api.warmDictation();
          }}
          onClick={() => {
            if (mine) void stopDictation();
            else if (dictationModelState().status !== "ready")
              setPrompt(!prompt);
            else start.current();
          }}
        >
          <span className="dictation-icon" aria-hidden>
            <Mic size={15} />
            {progress !== undefined && (
              <svg className="dictation-progress" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10.5" pathLength="100" />
                <circle
                  className="dictation-progress-fill"
                  cx="12"
                  cy="12"
                  r="10.5"
                  pathLength="100"
                  strokeDasharray="100"
                  strokeDashoffset={100 * (1 - progress)}
                />
              </svg>
            )}
          </span>
          {shown && (
            <DictationWave
              analyser={session.analyser}
              active={mine && session.phase === "listening" && !session.loading}
              settling={!mine || session.phase === "finishing"}
            />
          )}
          <span className="dictation-finish" aria-hidden />
        </button>
      </MicrophoneMenu>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          anchor={button}
          side="top"
          align="end"
          sideOffset={8}
        >
          <Popover.Popup className="composer-select-popup dictation-prompt">
            {error ? (
              <>
                <p className="dictation-prompt-title">Can't dictate</p>
                <p className="dictation-prompt-note">{error}</p>
              </>
            ) : (
              <ModelPrompt shortcut={shortcut} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Right-click on the mic: which microphone to listen to. */
function MicrophoneMenu({
  disabled,
  children,
}: {
  disabled?: boolean;
  /** The mic button, which becomes the trigger. */
  children: ReactElement;
}) {
  // Listed up front so the menu doesn't open short and then grow.
  const options = useMicrophones();
  const chosen = useDictationMicrophone();
  const value = options.some((o) => o.value === chosen) ? chosen : "";
  return (
    <ContextMenu.Root disabled={disabled}>
      <ContextMenu.Trigger render={children} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="composer-popup-positioner">
          <ContextMenu.Popup
            className="composer-select-popup"
            aria-label="Microphone"
          >
            <ContextMenu.Group>
              <ContextMenu.GroupLabel className="composer-menu-label">
                Microphone
              </ContextMenu.GroupLabel>
              <ContextMenu.RadioGroup
                value={value}
                onValueChange={setDictationMicrophone}
              >
                {options.map((option) => (
                  <ContextMenu.RadioItem
                    className="composer-select-item"
                    key={option.value}
                    value={option.value}
                    closeOnClick
                  >
                    {option.label}
                    <ContextMenu.RadioItemIndicator>
                      <Check size={13} />
                    </ContextMenu.RadioItemIndicator>
                  </ContextMenu.RadioItem>
                ))}
              </ContextMenu.RadioGroup>
            </ContextMenu.Group>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ModelPrompt({ shortcut }: { shortcut: string }) {
  const model = useDictationModel();
  if (model.status === "ready")
    return (
      <>
        <p className="dictation-prompt-title">Ready to dictate</p>
        <p className="dictation-prompt-note">
          {shortcut ? (
            <>
              Click the mic or tap <kbd>{shortcut}</kbd> to start and stop. Hold{" "}
              <kbd>{shortcut}</kbd> to talk and let go to finish.
            </>
          ) : (
            "Click the mic to start and stop."
          )}{" "}
          <kbd>Esc</kbd> discards.
        </p>
      </>
    );
  const received =
    model.status === "downloading" ||
    model.status === "failed" ||
    model.status === "missing"
      ? (model.received ?? 0)
      : 0;
  return (
    <>
      <p className="dictation-prompt-title">Dictate your messages</p>
      <p className="dictation-prompt-note">
        Words appear as you speak. NVIDIA's Parakeet model turns speech into
        text on this computer, in English and 24 other European languages;
        nothing leaves it. It's a one-time {megabytes(dictationModelSize)} MB
        download.
      </p>
      {model.status === "downloading" ? (
        <>
          <div
            className="usage-track"
            role="progressbar"
            aria-label="Speech model download"
            aria-valuemin={0}
            aria-valuemax={model.total}
            aria-valuenow={received}
          >
            <span
              className="usage-fill"
              style={{ width: `${(100 * received) / model.total}%` }}
            />
          </div>
          <div className="dictation-prompt-row">
            <span>
              {megabytes(received)} of {megabytes(model.total)} MB
            </span>
            <button
              type="button"
              className="dictation-prompt-link"
              onClick={() => void api.cancelDictationDownload()}
            >
              Pause
            </button>
          </div>
        </>
      ) : (
        <>
          {model.status === "failed" && (
            <p className="dictation-prompt-error" role="alert">
              {model.error}
            </p>
          )}
          <button
            type="button"
            className="primary dictation-prompt-download"
            onClick={() => void api.downloadDictationModel()}
          >
            {received ? "Resume download" : "Download model"}
          </button>
        </>
      )}
    </>
  );
}
