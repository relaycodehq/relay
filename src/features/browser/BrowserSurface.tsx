import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ExternalLink,
  Globe,
  LayoutGrid,
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
import {
  openPreview,
  pickedContext,
  previewKey,
  usePreviewState,
} from "./previews";
import { useNativeView } from "./useNativeView";
import "./browser.css";

/**
 * The thread's own browser: its dev server's page in a cookie jar of its
 * own, laid over the panel as a native view.
 */
export function BrowserSurface({
  projectId,
  chatId,
  front,
  onPick,
}: {
  projectId: string;
  chatId: string | null;
  /** Its tab is in front, in an open panel. */
  front: boolean;
  /** Hands a clicked element to the composer. */
  onPick: (context: ReturnType<typeof pickedContext>) => void;
}) {
  const key = previewKey(projectId, chatId);
  const state = usePreviewState(key);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    if (!front) return;
    setOpening(null);
    openPreview(projectId, chatId).catch((e: Error) => setOpening(e.message));
  }, [projectId, chatId, front]);
  const act = (action: PreviewAction) => {
    setOpening(null);
    void api
      .previewAction(key, action)
      .catch((e: Error) => setOpening(e.message));
  };
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
        onPick={async () => {
          const picked = await api.pickPreviewElement(key);
          if (picked) onPick(pickedContext(picked));
        }}
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
          <BrowserNotice state={state} failure={opening} onAct={act} />
        )}
      </div>
    </div>
  );
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
          state?.picking ? "Stop picking (Esc)" : "Pick an element to ask about"
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
      <IconButton
        label="All previews in browser"
        disabled={!state}
        onClick={() => onAct("previewIndex")}
      >
        <LayoutGrid size={14} />
      </IconButton>
    </form>
  );
}

/** What shows instead of the page: why there is none yet. */
function BrowserNotice({
  state,
  failure,
  onAct,
}: {
  state?: PreviewState;
  failure: string | null;
  onAct: (action: PreviewAction) => void;
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
        <p>{state.error}</p>
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
