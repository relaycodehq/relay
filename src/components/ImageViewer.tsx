import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  ImageOff,
  Link,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  clampView,
  fitScale,
  MAX_SCALE,
  stepScale,
  zoomTo,
  type ImageView,
  type Size,
} from "../lib/image-zoom";
import { CopyImageMenu } from "./CopyImageMenu";
import { imageQuery, useImageSource, type PreviewImage } from "./ImagePreview";
import { Spinner } from "./ui";
import "./image-viewer.css";

const mac = navigator.platform.includes("Mac");
const mod = mac ? "⌘" : "Ctrl+";

/** "PNG · 245 KB", read off the data URL without decoding it again. */
function fileFacts(source: string) {
  const comma = source.indexOf(",");
  const type = source.slice(5, source.indexOf(";")).replace("image/", "");
  const padding = source.endsWith("==") ? 2 : source.endsWith("=") ? 1 : 0;
  const bytes = ((source.length - comma - 1) * 3) / 4 - padding;
  const size =
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${type.toUpperCase()} · ${size}`;
}

/** Briefly swaps an action's icon for a check once it's done. */
function useDone() {
  const [done, setDone] = useState<string>();
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(undefined), 1200);
    return () => clearTimeout(timer);
  }, [done]);
  return [done, setDone] as const;
}

/**
 * The images of one turn, one at a time over the whole window: fitted to
 * start, zoomed with a pinch, ⌘-scroll, the keys or a double-click, dragged
 * around once larger than the window, and stepped through with the arrows or
 * the strip along the bottom.
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: PreviewImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const dialog = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data: source, error, refetch, isFetching } = useImageSource(image);
  // Per image, so stepping to the next one starts fitted.
  const [loaded, setLoaded] = useState<{ key: string; size: Size }>();
  const [zoom, setZoom] = useState<{
    key: string;
    view: ImageView;
    /** Eases to a view picked by a button or key; follows the pointer directly. */
    glide: boolean;
  }>();
  const [broken, setBroken] = useState<string>();
  const [stage, setStage] = useState<Size>();
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    view: ImageView;
    moved: boolean;
    /** Pressed beside the picture rather than on it. */
    backdrop: boolean;
  }>(undefined);
  const [done, setDone] = useDone();
  const [failure, setFailure] = useState<string>();

  const natural = loaded?.key === image.key ? loaded.size : undefined;
  const fit = natural && stage ? fitScale(natural, stage) : 1;
  const zoomed =
    natural && stage && zoom?.key === image.key && zoom.view.scale > fit + 1e-6
      ? zoom
      : undefined;
  const view: ImageView =
    zoomed && natural && stage
      ? clampView(zoomed.view, natural, stage)
      : { scale: fit, x: 0, y: 0 };
  const pannable =
    !!zoomed &&
    !!natural &&
    !!stage &&
    (natural.width * view.scale > stage.width ||
      natural.height * view.scale > stage.height);
  const imageBroken = broken === image.key;

  useEffect(() => {
    dialog.current?.showModal();
    stageRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setStage({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The neighbours load while this one is looked at, so stepping is instant.
  useEffect(() => {
    for (const neighbour of [images[index - 1], images[index + 1]])
      if (neighbour) void queryClient.prefetchQuery(imageQuery(neighbour));
  }, [images, index, queryClient]);

  useEffect(() => setFailure(undefined), [image.key]);

  const setView = (next: ImageView | undefined, glide = false) =>
    setZoom(next && { key: image.key, view: next, glide });

  const zoomAt = (scale: number, at = { x: 0, y: 0 }, glide = true) => {
    if (!natural || !stage) return;
    const next = zoomTo(view, scale, at, natural, stage);
    setView(next.scale > fit + 1e-6 ? next : undefined, glide);
  };

  /** The pointer relative to the stage's centre, where views are measured from. */
  const fromCentre = (clientX: number, clientY: number) => {
    const box = stageRef.current!.getBoundingClientRect();
    return {
      x: clientX - box.left - box.width / 2,
      y: clientY - box.top - box.height / 2,
    };
  };

  const step = (by: number) => {
    const next = index + by;
    if (next >= 0 && next < images.length) onIndex(next);
  };

  const run = (label: string, action: () => Promise<void>) =>
    void Promise.resolve()
      .then(action)
      .then(
        () => setDone(label),
        (e: unknown) =>
          setFailure(e instanceof Error ? e.message : `Couldn't ${label}.`),
      );
  const copyImage = () => {
    if (source) run("copy image", () => api.writeClipboardImage(source));
  };
  const copyPath = () => {
    const path = image.path;
    if (path) run("copy path", () => api.writeClipboard(path));
  };
  const reveal = () => {
    if (image.reveal) run("show in Finder", image.reveal);
  };

  // Keys belong to the viewer while it's open, except inside its copy menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest?.('[role="menu"]')) return;
      const command = event.metaKey || event.ctrlKey;
      const actions: Record<string, (() => void) | undefined> = {
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        "0": () => setView(undefined, true),
        "1": () => zoomAt(1),
        "+": () => zoomAt(stepScale(view.scale, 1)),
        "=": () => zoomAt(stepScale(view.scale, 1)),
        "-": () => zoomAt(stepScale(view.scale, -1)),
      };
      const action =
        command && event.key === "c"
          ? window.getSelection()?.isCollapsed === false
            ? undefined
            : copyImage
          : command || event.altKey
            ? undefined
            : actions[event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Pinch or ⌘-scroll zooms under the pointer; scrolling pans a zoomed image.
  // Native so it can stop the page behind from scrolling.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!natural || !stage) return;
      if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-30, Math.min(30, event.deltaY));
        zoomAt(
          view.scale * Math.exp(-delta * 0.01),
          fromCentre(event.clientX, event.clientY),
          false,
        );
      } else if (zoomed)
        setView(
          clampView(
            { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY },
            natural,
            stage,
          ),
        );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = undefined;
    if (event.button !== 0 || (event.target as Element).closest("button"))
      return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      view,
      moved: false,
      backdrop: event.target === event.currentTarget,
    };
    if (!pannable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || !natural || !stage) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
    if (pannable)
      setView(
        clampView(
          { ...start.view, x: start.view.x + dx, y: start.view.y + dy },
          natural,
          stage,
        ),
      );
  };
  const onPointerUp = () => {
    setDragging(false);
    // Cleared after the click that follows, which needs to know about the drag.
    setTimeout(() => (drag.current = undefined));
  };

  const facts =
    natural &&
    source &&
    `${natural.width} × ${natural.height} · ${fileFacts(source)}`;
  const frame = {
    "--image-width": `${natural?.width ?? 0}px`,
    "--image-height": `${natural?.height ?? 0}px`,
    "--image-x": `${view.x}px`,
    "--image-y": `${view.y}px`,
    "--image-scale": view.scale,
  } as CSSProperties;

  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label={
        images.length > 1
          ? `${image.name}, image ${index + 1} of ${images.length}`
          : image.name
      }
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="image-viewer-bar">
        <div className="image-viewer-title">
          <h2>
            <span>{image.name}</span>
            {facts && <small>{facts}</small>}
          </h2>
          {image.location && (
            <p className="image-viewer-location" title={image.path}>
              <bdi>{image.location}</bdi>
            </p>
          )}
        </div>
        {failure && (
          <span className="image-viewer-failure" role="alert">
            {failure}
          </span>
        )}
        {images.length > 1 && (
          <span className="image-viewer-count">
            {index + 1} of {images.length}
          </span>
        )}
        <div className="image-viewer-tools">
          <button
            type="button"
            title={`Zoom out (−)`}
            aria-label="Zoom out"
            disabled={!natural || !zoomed}
            onClick={() => zoomAt(stepScale(view.scale, -1))}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="image-viewer-scale"
            title={zoomed ? "Fit to window (0)" : "Actual size (1)"}
            disabled={!natural || (!zoomed && fit >= 1)}
            onClick={() => (zoomed ? setView(undefined, true) : zoomAt(1))}
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            title="Zoom in (+)"
            aria-label="Zoom in"
            disabled={!natural || view.scale >= MAX_SCALE}
            onClick={() => zoomAt(stepScale(view.scale, 1))}
          >
            <Plus size={15} />
          </button>
          <span className="image-viewer-separator" />
          <button
            type="button"
            title={`Copy image (${mod}C)`}
            aria-label="Copy image"
            disabled={!source}
            onClick={copyImage}
          >
            {done === "copy image" ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {image.path && (
            <button
              type="button"
              title="Copy path"
              aria-label="Copy path"
              onClick={copyPath}
            >
              {done === "copy path" ? <Check size={15} /> : <Link size={15} />}
            </button>
          )}
          {image.reveal && (
            <button
              type="button"
              title={mac ? "Show in Finder" : "Show in folder"}
              aria-label={mac ? "Show in Finder" : "Show in folder"}
              onClick={reveal}
            >
              <FolderOpen size={15} />
            </button>
          )}
          <span className="image-viewer-separator" />
          <button
            type="button"
            title="Close (Esc)"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div
        ref={stageRef}
        tabIndex={-1}
        className="image-viewer-stage"
        data-cursor={
          dragging
            ? "grabbing"
            : pannable
              ? "grab"
              : natural && fit < 1
                ? "zoom-in"
                : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          if (!natural) return;
          if (zoomed) setView(undefined, true);
          else
            zoomAt(fit < 1 ? 1 : 2, fromCentre(event.clientX, event.clientY));
        }}
        onClick={() => {
          // Beside the picture, a plain click closes, like a dialog's backdrop.
          if (drag.current?.backdrop && !drag.current.moved) onClose();
        }}
        data-glide={zoom?.glide && zoom.key === image.key ? "" : undefined}
        data-pixels={view.scale >= 2 ? "" : undefined}
        style={frame}
      >
        {source && !imageBroken && (
          <CopyImageMenu
            source={source}
            inDialog
            className="image-viewer-frame"
          >
            <img
              key={image.key}
              src={source}
              alt={image.name}
              draggable={false}
              data-loaded={natural ? "" : undefined}
              onLoad={(event) =>
                setLoaded({
                  key: image.key,
                  size: {
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  },
                })
              }
              onError={() => setBroken(image.key)}
            />
          </CopyImageMenu>
        )}
        {error || imageBroken ? (
          <div className="image-viewer-message" role="alert">
            <ImageOff size={22} />
            <p>
              {imageBroken
                ? "This file couldn't be decoded as an image."
                : error?.message}
            </p>
            {error && (
              <button
                type="button"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          !natural && (
            <div className="image-viewer-message">
              <Spinner size={18} />
            </div>
          )
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="image-viewer-step previous"
              aria-label="Previous image"
              title="Previous (←)"
              disabled={index === 0}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="image-viewer-step next"
              aria-label="Next image"
              title="Next (→)"
              disabled={index === images.length - 1}
              onClick={() => step(1)}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      {images.length > 1 && (
        <Filmstrip images={images} index={index} onIndex={onIndex} />
      )}
    </dialog>
  );
}

const Filmstrip = memo(function Filmstrip({
  images,
  index,
  onIndex,
}: {
  images: PreviewImage[];
  index: number;
  onIndex: (index: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [index]);
  return (
    <div ref={strip} className="image-viewer-strip" aria-label="Images">
      {images.map((image, i) => (
        <FilmstripImage
          key={image.key}
          image={image}
          current={i === index}
          onOpen={() => onIndex(i)}
        />
      ))}
    </div>
  );
});

function FilmstripImage({
  image,
  current,
  onOpen,
}: {
  image: PreviewImage;
  current: boolean;
  onOpen: () => void;
}) {
  const { data: source, isError } = useImageSource(image);
  return (
    <button
      type="button"
      aria-label={`Show ${image.name}`}
      aria-current={current || undefined}
      title={image.name}
      onClick={onOpen}
    >
      {source ? (
        <img src={source} alt="" draggable={false} />
      ) : isError ? (
        <ImageOff size={14} />
      ) : null}
    </button>
  );
}
