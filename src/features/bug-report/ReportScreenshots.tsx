import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, PenLine, Trash2 } from "lucide-react";
import type {
  BugReportPreview,
  BugReportScreenshot,
} from "../../../shared/bug-report";
import { api } from "../../lib/api";
import type { DraftImage } from "../images/draft-images";
import { SketchEditor } from "../images/ImageSketch";
import { dataUrl, reportImage, reportPng } from "./report-screenshot";

const emptyHistory = { past: [], present: [], future: [] };

/**
 * The report's screenshots. Each one goes through the sketch editor before
 * it's kept, and what's kept is the flattened PNG the thumbnail shows: the
 * same bytes the issue gets.
 */
export function ReportScreenshots({
  draftId,
  screenshots,
  locked,
  onChange,
  onError,
}: {
  draftId: string;
  screenshots: BugReportScreenshot[];
  locked: boolean;
  onChange: (preview: BugReportPreview) => void;
  onError: (error: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{
    image: DraftImage;
    replacing?: string;
  }>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const client = useQueryClient();
  // Redaction creates a new immutable id. Removed/replaced drafts must not
  // retain either their PNG bytes or their larger data URL in the cache.
  useEffect(() => {
    const kept = new Set(screenshots.map((shot) => shot.id));
    client.removeQueries({
      queryKey: ["bug-report-screenshot"],
      predicate: (query) => !kept.has(String(query.queryKey[1])),
    });
  }, [client, screenshots]);

  async function edit(file: File, replacing?: string, name?: string) {
    try {
      const image = await reportImage(file, name);
      if (mounted.current) setEditing({ image, replacing });
    } catch (error) {
      if (mounted.current) onError(error);
    }
  }

  async function keep(image: DraftImage, replacing?: string) {
    setBusy(true);
    try {
      const png = await reportPng(image);
      if (!mounted.current) return;
      const next = await api.addBugReportScreenshot(
        draftId,
        image.name,
        png,
        replacing,
      );
      if (mounted.current) onChange(next);
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  // Pasting anywhere on the page adds the image.
  useEffect(() => {
    if (locked) return;
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) =>
        f.type.startsWith("image/"),
      );
      if (!file) return;
      event.preventDefault();
      void edit(file);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });

  return (
    <div
      className="report-shots"
      onDragOver={(e) => {
        if (!locked && e.dataTransfer.types.includes("Files"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) =>
          f.type.startsWith("image/"),
        );
        if (locked || !file) return;
        e.preventDefault();
        void edit(file);
      }}
    >
      {screenshots.map((shot) => (
        <Shot
          key={shot.id}
          shot={shot}
          locked={locked}
          onEdit={(bytes) =>
            edit(
              new File([bytes.slice().buffer], `${shot.name}.png`, {
                type: "image/png",
              }),
              shot.id,
              shot.name,
            )
          }
          onRemove={() =>
            api.removeBugReportScreenshot(shot.id).then(
              (next) => mounted.current && onChange(next),
              (error) => mounted.current && onError(error),
            )
          }
        />
      ))}
      {!locked && (
        <div className="report-shot-adder">
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={14} />
            {busy ? "Saving…" : "Add screenshot…"}
          </button>
          <span className="muted">
            or paste or drop one. You can blur or black out anything private
            before it's added.
          </span>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void edit(file);
        }}
      />
      {editing && (
        <SketchEditor
          key={editing.image.id}
          image={editing.image}
          history={emptyHistory}
          onClose={(history, size) => {
            setEditing(undefined);
            void keep(
              {
                ...editing.image,
                sketch: { ...size, strokes: history.present },
              },
              editing.replacing,
            );
          }}
        />
      )}
    </div>
  );
}

function Shot({
  shot,
  locked,
  onEdit,
  onRemove,
}: {
  shot: BugReportScreenshot;
  locked: boolean;
  onEdit: (bytes: Uint8Array) => void;
  onRemove: () => void;
}) {
  const loaded = useScreenshot(shot.id);
  const bytes = loaded?.bytes;
  const url = loaded?.url;
  return (
    <figure className="report-shot">
      {url ? (
        <img src={url} alt={shot.name} />
      ) : (
        <div className="report-shot-blank" />
      )}
      <figcaption>
        <span title={shot.name}>{shot.name}</span>
        <small>
          {shot.width}×{shot.height} · {formatBytes(shot.bytes)}
        </small>
      </figcaption>
      {!locked && (
        <div className="report-shot-actions">
          <button
            type="button"
            aria-label={`Edit ${shot.name}`}
            title="Draw, blur or black out"
            disabled={!bytes}
            onClick={() => bytes && onEdit(bytes)}
          >
            <PenLine size={14} />
          </button>
          <button
            type="button"
            aria-label={`Remove ${shot.name}`}
            title="Remove from the report"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </figure>
  );
}

export function useScreenshot(id: string) {
  return useQuery({
    queryKey: ["bug-report-screenshot", id],
    // Immutable ids let the strip and preview share one load. Keep data for a
    // short page revisit, then release both copies when nobody displays it.
    staleTime: Infinity,
    gcTime: 30_000,
    queryFn: async ({ signal }) => {
      const bytes = await api.bugReportScreenshot(id);
      signal.throwIfAborted();
      return {
        bytes,
        // The page's CSP allows data: images, not blob: ones.
        url: await dataUrl(
          new Blob([bytes.slice().buffer], { type: "image/png" }),
        ),
      };
    },
  }).data;
}

export const formatBytes = (n: number) =>
  n < 1000
    ? `${n} B`
    : n < 1_000_000
      ? `${Math.round(n / 1000)} KB`
      : `${(n / 1_000_000).toFixed(1)} MB`;
