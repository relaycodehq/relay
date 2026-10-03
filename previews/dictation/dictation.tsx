// Dictation in the composer, on sample data: a recorded clip plays through the
// real capture path and waveform, and a stand-in engine replays the text the
// real Parakeet engine produced for that clip, with its real timing.
// Open http://127.0.0.1:5177/previews/dictation.html
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, Paperclip } from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/features/agents/composer-model-picker.css";
import "./dictation.css";
import { initAppearance, setMode, useAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "../../src/features/composer/ComposerPromptInput";
import { DictationButton } from "../../src/features/dictation/DictationButton";
import { DictationModelSetting } from "../../src/features/dictation/DictationSettings";
import { ShortcutKeys } from "../../src/features/settings/ShortcutSettings";
import { useShortcutLabel } from "../../src/lib/shortcuts";
import { dictationSnapshot, stopDictation } from "../../src/features/dictation/audio/session";
import type {
  DictationModelState,
  DictationRequest,
} from "../../shared/dictation";
import type { Api } from "../../shared/types";
import sample from "./dictation-sample.json";

const clip = new URL("./dictation-sample.m4a", import.meta.url).href;

type Scenario = "ready" | "first-run" | "downloading" | "no-mic";
let scenario: Scenario = "ready";
let playAloud = false;

let model: DictationModelState = { status: "ready" };
const modelListeners = new Set<(state: DictationModelState) => void>();
function setModel(next: DictationModelState) {
  model = next;
  for (const listener of modelListeners) listener(next);
}
let download: number | undefined;
function simulateDownload(from = 0) {
  const total = 671_122_000;
  let received = from;
  clearInterval(download);
  download = window.setInterval(() => {
    received = Math.min(total, received + total / 90);
    if (received >= total) {
      clearInterval(download);
      setModel({ status: "ready" });
    } else setModel({ status: "downloading", received, total });
  }, 100);
}

// The recorded clip stands in for the microphone.
navigator.mediaDevices.getUserMedia = async () => {
  if (scenario === "no-mic")
    throw new DOMException("Permission denied", "NotAllowedError");
  const context = new AudioContext();
  const audio = await context.decodeAudioData(
    await (await fetch(clip)).arrayBuffer(),
  );
  const source = context.createBufferSource();
  source.buffer = audio;
  const out = context.createMediaStreamDestination();
  source.connect(out);
  if (playAloud) source.connect(context.destination);
  source.start();
  const stream = out.stream;
  const [track] = stream.getAudioTracks();
  const stop = track.stop.bind(track);
  track.stop = () => {
    stop();
    source.stop();
    void context.close();
  };
  return stream;
};

/** Replays the real engine's output for the clip, from when the mic opened. */
function fakeEngine(port: MessagePort) {
  let timers: number[] = [];
  let latest = "";
  port.onmessage = ({ data }: MessageEvent<DictationRequest>) => {
    if (data.type === "start") {
      const id = data.id;
      // The model loads for a moment on first use.
      timers.push(
        window.setTimeout(() => port.postMessage({ type: "ready" }), 600),
      );
      for (const [at, settled, tentative] of sample.events as [
        number,
        string,
        string,
      ][])
        timers.push(
          window.setTimeout(() => {
            latest = [settled, tentative].filter(Boolean).join(" ");
            port.postMessage({ type: "text", id, settled, tentative });
          }, at + 150),
        );
    } else if (data.type === "stop") {
      timers.forEach(clearTimeout);
      timers = [];
      const id = data.id;
      window.setTimeout(
        () => port.postMessage({ type: "final", id, text: latest }),
        200,
      );
    } else if (data.type === "cancel") {
      timers.forEach(clearTimeout);
      timers = [];
    }
  };
}

Object.assign(window.relay, {
  dictationState: async () => model,
  onDictationState: (callback: (state: DictationModelState) => void) => {
    modelListeners.add(callback);
    return () => modelListeners.delete(callback);
  },
  dictationMicrophone: async () => true,
  warmDictation: async () => {},
  connectDictation: async () => {
    const channel = new MessageChannel();
    fakeEngine(channel.port1);
    window.postMessage("relay:dictation-port", "*", [channel.port2]);
    return true;
  },
  downloadDictationModel: async () => {
    simulateDownload(model.status === "missing" ? (model.received ?? 0) : 0);
    return model;
  },
  cancelDictationDownload: async () => {
    clearInterval(download);
    if (model.status === "downloading")
      setModel({ status: "missing", received: model.received });
  },
  removeDictationModel: async () => {
    setModel({ status: "missing" });
    return model;
  },
} satisfies Partial<Api>);

initAppearance();
initWindowFocus();

function Composer() {
  const [draft, setDraft] = useState("");
  const promptInput = useRef<PromptInputHandle>(null);
  const input = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [owner] = useState(() => ({}));
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div className="dictation-preview-thread">
      {sent.map((message, i) => (
        <p key={i} className="dictation-preview-sent">
          {message}
        </p>
      ))}
      <div className="thread-compose-wrap">
        <form
          ref={form}
          className="project-composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setSent((all) => [...all, draft.trim()]);
            setDraft("");
          }}
        >
          <ComposerPromptInput
            inputRef={input}
            handleRef={promptInput}
            draftKey="dictation-preview"
            value={draft}
            onChange={setDraft}
            onCursor={() => {}}
            placeholder="Ask about the code, plan a change, or build something…"
            onKeyDownCapture={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              const now = dictationSnapshot();
              if (now.owner === owner && now.phase !== "idle")
                void stopDictation().then((finished) => {
                  if (finished) setTimeout(() => form.current?.requestSubmit());
                });
              else form.current?.requestSubmit();
            }}
          />
          <div className="composer-tools">
            <button type="button" className="composer-control">
              Opus 5.5
            </button>
            <span className="composer-divider" />
            <button
              type="button"
              className="composer-control"
              aria-label="Attach screenshot"
            >
              <Paperclip size={15} />
            </button>
            <span className="spacer" />
            <DictationButton
              owner={owner}
              target={() => promptInput.current?.dictation}
              composer={form}
              resetKey="dictation-preview"
            />
            <button className="primary send-message" aria-label="Send message">
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Preview() {
  const appearance = useAppearance();
  const [current, setCurrent] = useState<Scenario>("ready");
  const [aloud, setAloud] = useState(false);
  const shortcut = useShortcutLabel("dictate");
  const [composerKey, setComposerKey] = useState(0);
  useEffect(() => {
    scenario = current;
    clearInterval(download);
    if (current === "first-run") setModel({ status: "missing" });
    else if (current === "downloading") simulateDownload(671_122_000 * 0.3);
    else setModel({ status: "ready" });
    setComposerKey((key) => key + 1);
  }, [current]);
  useEffect(() => {
    playAloud = aloud;
  }, [aloud]);
  const scenarios: [Scenario, string][] = [
    ["ready", "Dictate"],
    ["first-run", "First run"],
    ["downloading", "Downloading"],
    ["no-mic", "Mic refused"],
  ];
  return (
    <main className="dictation-preview">
      <header>
        <strong>Dictation</strong>
        <span className="muted">
          Sample data: a recorded clip and the text Parakeet produced for it
        </span>
        <span className="spacer" />
        <div className="segmented">
          {scenarios.map(([id, label]) => (
            <button
              key={id}
              className={current === id ? "active" : ""}
              aria-pressed={current === id}
              onClick={() => setCurrent(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="dictation-preview-toggle">
          <input
            type="checkbox"
            checked={aloud}
            onChange={(e) => setAloud(e.target.checked)}
          />
          Play the clip aloud
        </label>
        <button
          onClick={() =>
            setMode(appearance.palette.kind === "dark" ? "light" : "dark")
          }
        >
          {appearance.palette.kind === "dark" ? "Light" : "Dark"}
        </button>
      </header>
      <p className="dictation-preview-hint muted">
        Click the mic, or tap <kbd>{shortcut}</kbd> to start and stop. Hold{" "}
        <kbd>{shortcut}</kbd> to talk and let go to finish. <kbd>Esc</kbd>{" "}
        discards. Enter while dictating finishes and sends.
      </p>
      <Composer key={composerKey} />
      <section className="dictation-preview-settings">
        <span>Speech model</span>
        <DictationModelSetting />
        <span>Shortcut</span>
        <ShortcutKeys id="dictate" />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
