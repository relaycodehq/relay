import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ExternalLink,
  Globe,
  PictureInPicture2,
  RotateCw,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import {
  previewUrl,
  type PreviewAction,
  type PreviewBounds,
  type PreviewState,
} from "../../../shared/preview";
import { api } from "../../lib/api";
import { IconButton } from "../../ui/ui";
import { openPreview, previewKey, usePreviewState } from "./previews";
import { useNativeView } from "../../lib/useNativeView";
import { useBrowserAnnotations } from "./useBrowserAnnotations";
import "./browser.css";

/**
 * The thread's own browser: its dev server's page in a cookie jar of its
 * own, laid over the panel as a native view.
 */
export function BrowserSurface({
  projectId,
  chatId,
  front,
  draftKey,
}: {
  projectId: string;
  chatId: string | null;
  /** Its tab is in front, in an open panel. */
  front: boolean;
  /** The main conversation's draft, even while its composer is hidden. */
  draftKey: string;
}) {
  const key = previewKey(projectId, chatId);
  const state = usePreviewState(key);
  const [opening, setOpening] = useState<string | null>(null);
  const inspect = useBrowserAnnotations(key, draftKey, front, setOpening);
  useEffect(() => {
    if (!front) return;
    setOpening(null);
    openPreview(projectId, chatId).catch((e: Error) => setOpening(e.message));
  }, [projectId, chatId, front]);
  const act = usePageActions(key, setOpening);
  const viewport = useRef<HTMLDivElement>(null);
  const place = useCallback(
    (bounds: PreviewBounds | null) => void api.placePreview(key, bounds),
    [key],
  );
  const server = state?.server.state;
  const showPage =
    front &&
    !!state?.url &&
    !state.error &&
    !state.poppedOut &&
    server !== "starting" &&
    server !== "failed";
  useNativeView(viewport, showPage, place);
  return (
    <div className="browser-surface">
      <AddressBar
        state={state}
        onAct={act}
        onGo={(url) => {
          setOpening(null);
          void api
            .navigatePreview(projectId, chatId, url)
            .catch((e: Error) => setOpening(e.message));
        }}
        onPick={() => void inspect()}
      />
      {opening && state?.url && (
        <div className="browser-action-error" role="alert">
          <span>{opening}</span>
          <IconButton
            label="Dismiss browser error"
            onClick={() => setOpening(null)}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      <div className="browser-viewport" ref={viewport}>
        {showPage && state.snapshot && (
          <img className="browser-snapshot" src={state.snapshot} alt="" />
        )}
        {!showPage && (
          <BrowserNotice
            state={state}
            failure={opening}
            onAct={act}
            onStart={(command) => {
              if (!state?.url) return;
              setOpening(null);
              void api
                .navigatePreview(projectId, chatId, state.url, command)
                .catch((e: Error) => setOpening(e.message));
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The address bar's actions on the page. */
function usePageActions(
  key: string,
  setOpening: (failure: string | null) => void,
) {
  const act = (action: PreviewAction) => {
    setOpening(null);
    void api
      .previewAction(key, action)
      .catch((e: Error) => setOpening(e.message));
  };
  return act;
}

function AddressBar({
  state,
  onAct,
  onGo,
  onPick,
}: {
  state?: PreviewState;
  onAct: (action: PreviewAction) => void;
  onGo: (url: string) => void;
  onPick: () => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? state?.url ?? "";
  const invalid = typed !== null && !!typed.trim() && !previewUrl(typed);
  return (
    <form
      className="browser-bar"
      onSubmit={(e) => {
        e.preventDefault();
        const url = previewUrl(shown);
        if (!url) return;
        setTyped(null);
        onGo(url);
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <IconButton
        label="Back"
        disabled={!state?.canGoBack}
        onClick={() => onAct("back")}
      >
        <ArrowLeft size={14} />
      </IconButton>
      <IconButton
        label="Forward"
        disabled={!state?.canGoForward}
        onClick={() => onAct("forward")}
      >
        <ArrowRight size={14} />
      </IconButton>
      {state?.loading ? (
        <IconButton label="Stop loading" onClick={() => onAct("stop")}>
          <X size={14} />
        </IconButton>
      ) : (
        <IconButton
          label="Reload"
          disabled={!state}
          onClick={() => onAct("reload")}
        >
          <RotateCw size={14} />
        </IconButton>
      )}
      <input
        className="browser-address"
        aria-label="Address"
        aria-invalid={invalid || undefined}
        spellCheck={false}
        placeholder="localhost:3000"
        value={shown}
        onChange={(e) => setTyped(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setTyped((t) => (t === state?.url ? null : t))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTyped(null);
            e.currentTarget.blur();
          }
        }}
      />
      <IconButton
        label={
          state?.picking ? "Stop annotating (Esc)" : "Comment on this page"
        }
        disabled={!state?.url || state.poppedOut}
        active={state?.picking}
        onClick={() => (state?.picking ? onAct("stopPicking") : onPick())}
      >
        <SquareDashedMousePointer size={14} />
      </IconButton>
      <IconButton
        label="Developer tools"
        disabled={!state?.url}
        onClick={() => onAct("devtools")}
      >
        <Bug size={14} />
      </IconButton>
      <IconButton
        label={
          state?.poppedOut
            ? "Bring back to the panel"
            : "Open in its own window"
        }
        disabled={!state}
        active={state?.poppedOut}
        onClick={() => onAct(state?.poppedOut ? "bringBack" : "popOut")}
      >
        <PictureInPicture2 size={14} />
      </IconButton>
      <IconButton
        label="Open in browser"
        disabled={!state?.url}
        onClick={() => onAct("openExternal")}
      >
        <ExternalLink size={14} />
      </IconButton>
    </form>
  );
}

/** What shows instead of the page: why there is none yet. */
function BrowserNotice({
  state,
  failure,
  onAct,
  onStart,
}: {
  state?: PreviewState;
  failure: string | null;
  onAct: (action: PreviewAction) => void;
  onStart: (command: string) => void;
}) {
  if (failure)
    return (
      <div className="browser-notice" role="alert">
        <p>{failure}</p>
      </div>
    );
  if (!state) return <div className="browser-notice" />;
  if (state.poppedOut)
    return (
      <div className="browser-notice">
        <ExternalLink size={22} />
        <p>Showing in its own window.</p>
        <button type="button" onClick={() => onAct("bringBack")}>
          Bring it back
        </button>
      </div>
    );
  const server = state.server;
  const stopped =
    state.error?.includes("ERR_CONNECTION_REFUSED") &&
    /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/])/.test(state.url);
  if (server.state === "starting")
    return (
      <div className="browser-notice">
        <p>
          Starting the dev server on port <code>{server.port}</code>…
        </p>
      </div>
    );
  if (server.state === "failed")
    return (
      <div className="browser-notice" role="alert">
        <p>
          The dev server didn’t start on port <code>{server.port}</code>.
        </p>
        {server.output && <pre className="browser-output">{server.output}</pre>}
        <button type="button" onClick={() => onAct("reload")}>
          Try again
        </button>
      </div>
    );
  if (state.error)
    return (
      <div className="browser-notice" role="alert">
        <p>{stopped ? "The preview server isn’t running." : state.error}</p>
        {server.state === "none" && stopped && (
          <PreviewStart onStart={onStart} />
        )}
        <button type="button" onClick={() => onAct("reload")}>
          Try again
        </button>
      </div>
    );
  return (
    <div className="browser-notice">
      <Globe size={22} />
      <p>Type an address above.</p>
      <small>
        Set a dev command and port in the project’s settings, and each thread’s
        preview starts its own server.
      </small>
    </div>
  );
}

/** A URL cannot tell us how to recreate its server. Ask once and remember it. */
function PreviewStart({ onStart }: { onStart: (command: string) => void }) {
  const [command, setCommand] = useState("");
  return (
    <form
      className="browser-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (command.trim()) onStart(command.trim());
      }}
    >
      <small>
        Save the dev command to start this preview now and when you return. It
        needs to listen on the address’s port.
      </small>
      <label htmlFor="preview-dev-command">Dev command</label>
      <input
        id="preview-dev-command"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="npm run dev"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
      />
      <button type="submit" disabled={!command.trim()}>
        Start preview
      </button>
    </form>
  );
}

/** A failed or missing favicon falls back to the browser's globe. */
export function BrowserTabIcon({ favicon }: { favicon?: string }) {
  const [failed, setFailed] = useState(false);
  return favicon && !failed ? (
    <img
      className="browser-tab-icon"
      src={favicon}
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <Globe size={14} />
  );
}
