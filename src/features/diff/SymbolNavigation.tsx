import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type {
  TokenEventBase,
  DiffTokenEventBaseProps,
  CodeViewFileItem,
} from "@pierre/diffs";
import { ArrowLeft, ArrowRight, Code2, ListTree, X } from "lucide-react";
import type { Pull } from "../../../shared/types";
import type {
  ProjectCheckState,
  SymbolQuery,
  SymbolResult,
  SymbolLocation,
} from "../../../shared/checks";
import { api } from "../../lib/api";
import { keys } from "../../lib/mod-key";
import { useTheme } from "../../lib/useTheme";
import { useSyntaxThemes } from "../../lib/appearance";
import { useTypography } from "../../lib/typography";
import { StyledDiffCodeView } from "../../vendor/t3code/StyledDiffCodeView";
import { ErrorBox, IconButton, Loading, Modal } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";

type SymbolTarget = Pull | { projectId: string; head: { sha: string } };
const inspect = (target: SymbolTarget, query: SymbolQuery) =>
  "projectId" in target
    ? api.inspectLocalSymbol(target.projectId, target.head.sha, query)
    : api.inspectSymbol(target, target.head.sha, query);
type Token = TokenEventBase | DiffTokenEventBaseProps;
type Action = "definition" | "references";
type Entry = { query: SymbolQuery; result: SymbolResult; id: number };
const queryFor = (
  path: string,
  hash: string,
  token: Token,
  kind: SymbolQuery["kind"],
): SymbolQuery => ({
  path,
  hash,
  line: token.lineNumber,
  column: token.lineCharStart + 1,
  kind,
});
const identifier = (token: Token) =>
  !("side" in token && token.side === "deletions") &&
  /[\p{L}_$]/u.test(token.tokenText);

/** A single symbol controller keeps peeks separate from review selection and unsaved buffers. */
export function useSymbolNavigation(
  pull: SymbolTarget,
  path: string,
  hash: string | undefined,
  checks: ProjectCheckState | null | undefined,
  /** What "Back to …" returns to, e.g. "review" or "editing". */
  returnTo: string,
) {
  const [hover, setHover] = useState<{
    query: SymbolQuery;
    result: SymbolResult;
    x: number;
    y: number;
  }>();
  const [selected, setSelected] = useState<SymbolQuery>();
  const [history, setHistory] = useState<Entry[]>([]);
  const [index, setIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0),
    hoverGeneration = useRef(0);
  const ready =
    checks?.status === "ready" && !!hash && checks.files[path]?.hash === hash;
  const clearHover = () => {
    clearTimeout(timer.current);
    hoverGeneration.current++;
    setHover(undefined);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      generation.current++;
      hoverGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    clearHover();
    setSelected(undefined);
  }, [path, hash, checks?.status]);
  const close = () => {
    generation.current++;
    setOpen(false);
    setBusy(false);
    setError(undefined);
  };
  const navigate = async (query: SymbolQuery, kind: Action) => {
    clearHover();
    const request = ++generation.current;
    setOpen(true);
    setBusy(true);
    setError(undefined);
    try {
      const q = { ...query, kind };
      const result = await inspect(pull, q);
      if (request !== generation.current) return;
      setHistory((previous) =>
        [
          ...previous.slice(0, index + 1),
          { query: q, result, id: request },
        ].slice(-30),
      );
      setIndex(Math.min(index + 1, 29));
    } catch (e) {
      if (request === generation.current) setError(e);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const handlers = {
    onTokenClick: (token: Token, event: MouseEvent) => {
      if (!identifier(token) || !hash) return;
      const query = queryFor(path, hash, token, "definition");
      setSelected(query);
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        void navigate(query, "definition");
      }
    },
    onTokenEnter: (token: Token) => {
      clearHover();
      if (!ready || !hash || !identifier(token) || open) return;
      const query = queryFor(path, hash, token, "hover"),
        rect = token.tokenElement.getBoundingClientRect(),
        request = hoverGeneration.current;
      timer.current = setTimeout(() => {
        void inspect(pull, query)
          .then((result) => {
            if (request === hoverGeneration.current && result.display)
              setHover({
                query,
                result,
                x: Math.max(12, Math.min(rect.left, window.innerWidth - 490)),
                y: Math.max(
                  12,
                  Math.min(rect.bottom + 5, window.innerHeight - 230),
                ),
              });
          })
          .catch(() => {});
      }, 450);
    },
    onTokenLeave: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(clearHover, 250);
    },
  };
  return {
    ready,
    handlers,
    at: (line: number, column: number, kind: Action) => {
      if (hash) void navigate({ path, hash, line, column, kind }, kind);
    },
    controls: (
      <div className="symbol-actions">
        <span>{keys("⌘", "Ctrl")} click · Definition</span>
        <button
          disabled={!ready || !selected}
          onClick={() => selected && void navigate(selected, "definition")}
          title="Click a symbol, then go to its definition"
        >
          <Code2 size={13} />
          Definition
        </button>
        <button
          disabled={!ready || !selected}
          onClick={() => selected && void navigate(selected, "references")}
          title="Click a symbol, then find its usages"
        >
          <ListTree size={13} />
          Find usages
        </button>
      </div>
    ),
    overlay: (
      <>
        {hover && !open && (
          <div
            className="symbol-hover"
            role="region"
            aria-label="Symbol information"
            style={{ left: hover.x, top: hover.y }}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={clearHover}
          >
            <pre>{hover.result.display}</pre>
            {hover.result.documentation && <p>{hover.result.documentation}</p>}
            <div>
              <button onClick={() => void navigate(hover.query, "definition")}>
                Go to definition
              </button>
              <button onClick={() => void navigate(hover.query, "references")}>
                Find usages
              </button>
              <IconButton
                label="Dismiss symbol information"
                onClick={clearHover}
              >
                <X size={13} />
              </IconButton>
            </div>
          </div>
        )}
        {open && (
          <Modal
            title={
              history[index]?.query.kind === "references"
                ? "Find usages"
                : "Go to definition"
            }
            className="symbol-modal"
            onClose={close}
          >
            <div className="symbol-nav">
              <IconButton
                label="Previous symbol"
                disabled={index <= 0 || busy}
                onClick={() => {
                  setIndex((i) => i - 1);
                  setError(undefined);
                }}
              >
                <ArrowLeft size={16} />
              </IconButton>
              <IconButton
                label="Next symbol"
                disabled={index >= history.length - 1 || busy}
                onClick={() => {
                  setIndex((i) => i + 1);
                  setError(undefined);
                }}
              >
                <ArrowRight size={16} />
              </IconButton>
              <span>Local project · read-only preview</span>
              <button onClick={close}>Back to {returnTo}</button>
            </div>
            {!!error && <ErrorBox error={error} />}{" "}
            {busy ? (
              <Loading text="Resolving symbol…" />
            ) : (
              history[index] && (
                <SymbolResults
                  key={history[index].id}
                  pull={pull}
                  entry={history[index]}
                  onNavigate={navigate}
                />
              )
            )}
          </Modal>
        )}
      </>
    ),
  };
}

function SymbolResults({
  pull,
  entry,
  onNavigate,
}: {
  pull: SymbolTarget;
  entry: Entry;
  onNavigate: (query: SymbolQuery, kind: Action) => Promise<void>;
}) {
  const { result } = entry;
  const [selected, setSelected] = useState<SymbolLocation | undefined>(
    result.locations[0],
  );
  const [limit, setLimit] = useState(60);
  const [filter, setFilter] = useState("");
  const matches = result.locations.filter((l) =>
    `${l.path} ${l.preview}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <div className="symbol-summary">
        <pre>{result.display || "Symbol locations"}</pre>
        <span>
          {result.locations.length}
          {result.truncated ? "+" : ""}{" "}
          {entry.query.kind === "references" ? "usages" : "definitions"}
          {result.external ? " · external dependencies omitted" : ""}
        </span>
        {result.documentation && <p>{result.documentation}</p>}
      </div>
      {!result.locations.length ? (
        <div className="empty small">
          {result.external
            ? "This symbol is defined in an external dependency."
            : "No locations found in the selected compiler project."}
        </div>
      ) : (
        <div className="symbol-results">
          <aside>
            <input
              aria-label="Filter symbol locations"
              placeholder="Filter locations…"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setLimit(60);
              }}
            />
            <div className="symbol-location-list">
              {matches.slice(0, limit).map((l) => (
                <button
                  className={selected === l ? "selected" : ""}
                  key={`${l.path}:${l.line}:${l.column}`}
                  onClick={() => setSelected(l)}
                >
                  <strong>
                    {l.path.split("/").pop()}
                    <small>
                      {l.line}:{l.column}
                    </small>
                  </strong>
                  <span title={l.path}>{l.path}</span>
                  <code>{l.preview}</code>
                </button>
              ))}
              {matches.length > limit && (
                <button onClick={() => setLimit((n) => n + 60)}>
                  More locations
                </button>
              )}
            </div>
          </aside>
          {selected && (
            <SymbolPreview
              pull={pull}
              location={selected}
              onNavigate={onNavigate}
            />
          )}
        </div>
      )}
    </>
  );
}
function SymbolPreview({
  pull,
  location,
  onNavigate,
}: {
  pull: SymbolTarget;
  location: SymbolLocation;
  onNavigate: (query: SymbolQuery, kind: Action) => Promise<void>;
}) {
  const [source, setSource] = useState<SymbolResult["source"]>();
  const [error, setError] = useState<unknown>();
  const [selection, setSelection] = useState<SymbolQuery>();
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null),
    theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const { wrap } = useTypography();
  useEffect(() => {
    let current = true;
    setSource(undefined);
    setError(undefined);
    setSelection(undefined);
    void inspect(pull, {
      path: location.path,
      hash: location.hash,
      line: location.line,
      column: location.column,
      kind: "source",
    })
      .then((r) => {
        if (current) setSource(r.source);
      })
      .catch((e) => {
        if (current) setError(e);
      });
    return () => {
      current = false;
    };
  }, [location, pull.head.sha]);
  const items = useMemo<CodeViewFileItem[]>(
    () =>
      source
        ? [
            {
              id: source.path,
              type: "file",
              file: {
                name: source.path,
                contents: source.text,
                cacheKey: source.hash,
              },
            },
          ]
        : [],
    [source],
  );
  useEffect(() => {
    if (!source) return;
    const frame = requestAnimationFrame(() =>
      viewer.current?.scrollTo({
        type: "line",
        id: source.path,
        lineNumber: location.line,
        align: "center",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [source, location]);
  return (
    <div className="symbol-preview">
      <div className="symbol-preview-heading">
        <MiddleTruncate
          text={`${location.path}:${location.line}`}
          kind="path"
          title={location.path}
        />
        <button
          disabled={!selection}
          onClick={() => selection && void onNavigate(selection, "definition")}
        >
          Definition
        </button>
        <button
          disabled={!selection}
          onClick={() => selection && void onNavigate(selection, "references")}
        >
          Find usages
        </button>
      </div>
      {!!error ? (
        <ErrorBox error={error} />
      ) : !source ? (
        <Loading text="Loading source…" />
      ) : (
        <StyledDiffCodeView
          viewerRef={viewer}
          className="diff-code-view symbol-code"
          unsafeCSSExtra={`:host {color-scheme:${theme} !important;} [data-file] {transition:none !important; opacity:1 !important;}`}
          items={items}
          selectedLines={{
            id: source.path,
            range: { start: location.line, end: location.line },
          }}
          options={{
            theme: syntaxThemes,
            themeType: theme,
            disableFileHeader: true,
            preferredHighlighter: "shiki-js",
            useTokenTransformer: true,
            overflow: wrap ? "wrap" : "scroll",
            tokenizeMaxLength: 5000,
            tokenizeMaxLineLength: 1000,
            onTokenClick: (token, event) => {
              const q = queryFor(source.path, source.hash, token, "definition");
              setSelection(q);
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                void onNavigate(q, "definition");
              }
            },
          }}
        />
      )}
    </div>
  );
}
