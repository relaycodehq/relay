import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";
import { agentMentionPattern } from "../../../shared/agents";
import {
  cleanPaste,
  isLongPaste,
  pasteMarkdown,
  pastedTexts,
  type PastedText,
} from "../../../shared/pasted-texts";
import { api } from "../../lib/api";
import {
  isScreenshot,
  loadDraftImages,
  prepareScreenshot,
  saveDraftImages,
  type DraftImage,
} from "../images/draft-images";
import { readDraft, useDraft, writeDraft } from "./drafts";
import {
  attachedImages,
  dataUrlBytes,
  nextImageNumber,
  onlyImageTokens,
} from "../images/image-refs";
import { useImagePills } from "../images/image-pills";
import type { Sketch, SketchHistory } from "../images/sketch";
import { takeLegacyPastes } from "../../lib/thread-storage";

export type ComposerDraft = ReturnType<typeof useComposerDraft>;

type Point = { left: number; top: number };

/** What the draft asks of the editor showing it. */
export interface DraftEditor {
  /** Puts files in as tags where the pointer is, or at the caret without one. */
  insertFiles: (paths: string[], point?: Point) => void;
  /** Puts screenshot pills in, like files. */
  insertImages: (ns: number[], point?: Point) => void;
  /** Drops every pill for screenshot n. */
  removeImage: (n: number) => void;
  /** Puts a long paste at the caret as a pill; false when the message cannot hold it. */
  insertPaste: (text: string) => boolean;
  /** Replaces a range of the draft with plain text, or removes it, and puts the caret after it. */
  insertText: (range: { start: number; end: number; text: string }) => void;
}

/**
 * The composer's draft: its text, kept under `key`, and what comes into it
 * besides typing. Screenshots are kept beside the text, long pastes become
 * pills in it, and other files go in as their paths.
 */
export function useComposerDraft(
  key: string,
  shared: boolean,
  editor: RefObject<DraftEditor | null>,
) {
  const text = useDraft(key);
  const set = (value: string) => writeDraft(key, value);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef(false);
  const imageQueue = useRef<Promise<DraftImage[]>>(Promise.resolve([]));
  const [sketching, setSketching] = useState<string>();
  const sketchHistories = useRef(new Map<string, SketchHistory>());
  const imagePills = useImagePills();
  // A screenshot goes with the message while its pill is in the draft.
  const attached = useMemo(() => attachedImages(text, images), [text, images]);
  const chips = useMemo(
    () =>
      images.flatMap(({ n, name, dataUrl }) =>
        n === undefined
          ? []
          : [{ n, name, src: dataUrl, bytes: dataUrlBytes(dataUrl) }],
      ),
    [images],
  );
  // Paste pills live in the draft text; their cards mirror them in order.
  const pastes = useMemo(() => pastedTexts(text), [text]);
  // Earlier versions kept pastes beside the draft; move any left into it.
  useEffect(() => {
    const kept = takeLegacyPastes(key);
    if (kept === null) return;
    try {
      const value: unknown = JSON.parse(kept);
      const blocks = (Array.isArray(value) ? value : [])
        .filter(
          (p): p is PastedText =>
            Number.isInteger(p?.n) && typeof p.text === "string",
        )
        .map(pasteMarkdown)
        .join("");
      if (blocks) set(text.trimEnd() + blocks);
    } catch {
      // Nothing readable to keep.
    }
  }, [key]);
  useEffect(() => {
    let live = true;
    const loaded = loadDraftImages(key);
    imageQueue.current = loaded;
    void loaded
      .then((saved) => {
        if (live) setImages(saved);
      })
      .catch(() => {
        if (live) setError("Could not restore pasted screenshots.");
      });
    return () => {
      live = false;
    };
  }, [key]);
  async function addImages(files: File[], point?: Point) {
    if (!files.length) return;
    if (shared) {
      setError("Screenshots in shared conversations are not supported yet.");
      return;
    }
    if (preparation.current) return;
    preparation.current = true;
    setPreparing(true);
    setError(undefined);
    try {
      const existing = await imageQueue.current;
      const kept = attachedImages(text, existing);
      if (kept.length + files.length > 3)
        throw new Error("Attach up to three screenshots per message.");
      const first = nextImageNumber(text, existing);
      // A pill only means something next to words; pasted into a draft with
      // none, the screenshot just sits in the strip. Without a pill it has no
      // number, so it always goes along.
      const inText = imagePills && !onlyImageTokens(text);
      const prepared = (await Promise.all(files.map(prepareScreenshot))).map(
        (image, i) => (inText ? { ...image, n: first + i } : image),
      );
      // Screenshots whose pills were deleted make room here, not on undo.
      const next = [...kept, ...prepared];
      await saveDraftImages(key, next);
      imageQueue.current = Promise.resolve(next);
      setImages(next);
      editor.current?.insertImages(
        prepared.flatMap((image) => image.n ?? []),
        point,
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not attach screenshot.",
      );
    } finally {
      preparation.current = false;
      setPreparing(false);
    }
  }
  /** Screenshots attach; any other file goes in as its path, which the agent reads itself. */
  function addFiles(files: File[], point?: Point) {
    const others = files.filter((file) => !isScreenshot(file));
    if (others.length) insertPaths(others, point);
    void addImages(files.filter(isScreenshot), point);
  }
  function insertPaths(files: File[], point?: Point) {
    if (shared) {
      setError("Files in shared conversations are not supported yet.");
      return;
    }
    const paths = files.map((file) => api.pathForFile(file));
    const missing = files.find((_, i) => !paths[i]);
    if (missing) {
      setError(
        `Relay can't tell where "${missing.name}" is saved. Save it to disk and drop it again.`,
      );
      return;
    }
    setError(undefined);
    editor.current?.insertFiles(paths, point);
  }
  /** Keeps `next` as the draft's screenshots, saying `failed` if they can't be saved. */
  function keepImages(next: DraftImage[], failed: string) {
    setImages(next);
    imageQueue.current = saveDraftImages(key, next)
      .then(() => next)
      .catch(() => {
        setError(failed);
        return next;
      });
  }
  return {
    text,
    set,
    images,
    /** The screenshots that go with the message. */
    attached,
    /** The screenshots' pills, as the editor shows them. */
    chips,
    pastes,
    /** What went wrong bringing something in, or sending it. */
    error,
    setError,
    /** A screenshot is being prepared; the message waits for it. */
    preparing,
    /** The screenshot being drawn on. */
    sketching,
    sketch: setSketching,
    /** Where drawing on screenshot `id` left off. */
    historyOf: (image: DraftImage): SketchHistory =>
      sketchHistories.current.get(image.id) ?? {
        past: [],
        present: image.sketch?.strokes ?? [],
        future: [],
      },
    finishSketch(
      id: string,
      history: SketchHistory,
      size: Pick<Sketch, "width" | "height">,
    ) {
      sketchHistories.current.set(id, history);
      setSketching(undefined);
      keepImages(
        images.map((image) =>
          image.id === id
            ? {
                ...image,
                sketch: history.present.length
                  ? { ...size, strokes: history.present }
                  : undefined,
              }
            : image,
        ),
        "Could not save the drawing to the draft.",
      );
    },
    addFiles,
    /** An agent was picked, so an @mention would only override it. */
    dropMention() {
      const prefix = agentMentionPattern.exec(text.trimStart())?.[0];
      if (prefix)
        editor.current?.insertText({
          start: 0,
          end: text.length - text.trimStart().length + prefix.length,
          text: "",
        });
    },
    removeImage({ id, n }: DraftImage) {
      if (n !== undefined) editor.current?.removeImage(n);
      keepImages(
        images.filter((image) => image.id !== id),
        "Could not remove screenshot from the draft.",
      );
    },
    paste(event: ClipboardEvent) {
      const files = event.clipboardData.files.length
        ? Array.from(event.clipboardData.files)
        : Array.from(event.clipboardData.items)
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
      if (files.some((file) => file.type.startsWith("image/"))) {
        event.preventDefault();
        event.stopPropagation();
        void addImages(files);
        return;
      }
      // A long paste becomes a pill at the caret instead of flooding the draft.
      const pasted = cleanPaste(event.clipboardData.getData("text/plain"));
      if (!isLongPaste(pasted) || pastedTexts(pasted).length) return;
      event.preventDefault();
      event.stopPropagation();
      if (editor.current?.insertPaste(pasted)) setError(undefined);
      else
        setError(
          "That paste is too long. A message holds up to 32,000 characters.",
        );
    },
    drop(event: DragEvent) {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      addFiles(files, { left: event.clientX, top: event.clientY });
    },
    /**
     * Empties the composer as the message goes out; a message that is turned
     * down comes back, ahead of anything typed since.
     */
    take(withImages: boolean) {
      let taken: { text: string; images: DraftImage[] } | undefined;
      return {
        dispatch() {
          taken = { text, images: withImages ? images : [] };
          set("");
          if (withImages) setImages([]);
        },
        restore() {
          if (!taken) return;
          const { text, images: back } = taken,
            typed = readDraft(key).trim();
          set(typed ? `${text.trimEnd()}\n\n${typed}` : text);
          if (back.length) setImages((now) => [...back, ...now]);
        },
      };
    },
    /** The screenshots went out: their draft copy goes too. */
    async forgetSent() {
      if (!images.length) return;
      try {
        await saveDraftImages(key, []);
        imageQueue.current = Promise.resolve([]);
        sketchHistories.current.clear();
      } catch {
        setError(
          "Screenshot was sent, but its draft copy could not be cleared.",
        );
      }
    },
  };
}
