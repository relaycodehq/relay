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
  pastedTexts,
} from "../../../shared/pasted-texts";
import { api } from "../../lib/api";
import {
  isScreenshot,
  loadDraftImages,
  onDraftImagesChanged,
  onDraftImagesSaved,
  prepareScreenshot,
  saveDraftImages,
  type DraftImage,
} from "../images/draft-images";
import { onDraftTaken, readDraft, useDraft, writeDraft } from "./drafts";
import { splitDraftKey } from "../../lib/thread-draft";
import { draftChips } from "../../lib/thread-storage";
import { pickedSkills } from "../../../shared/skill-mentions";
import {
  attachedImages,
  dataUrlBytes,
  imageToken,
  nextImageNumber,
  onlyImageTokens,
  pastedImages,
  withoutImageTokens,
} from "../../../shared/image-refs";
import { droppedImage } from "../images/image-drag";
import { copiedImages } from "../images/image-clipboard";
import { useImagePills } from "../images/image-pills";
import type { Sketch, SketchHistory } from "../images/sketch";

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
  /** Puts copied text in at the caret, over any selection, its tokens as pills; false when the message cannot hold it. */
  pasteText: (text: string) => boolean;
  /** Puts a long paste at the caret as a pill; false when the message cannot hold it. */
  insertPaste: (text: string) => boolean;
  /** Replaces a range of the draft with plain text, or removes it, and puts the caret after it. */
  insertText: (range: { start: number; end: number; text: string }) => void;
  /** Takes on the pills copied `html` marks, before its text is pasted. */
  adoptPills: (html: string) => void;
}

const PASTE_TOO_LONG =
  "That paste is too long. A message holds up to 32,000 characters.";

/**
 * The composer's draft: its text, kept under `key`, and what comes into it
 * besides typing. Screenshots are kept beside the text, long pastes become
 * pills in it, and other files go in as their paths.
 */
export function useComposerDraft(
  key: string,
  editor: RefObject<DraftEditor | null>,
) {
  const text = useDraft(key);
  const set = (value: string) => writeDraft(key, value);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef<Promise<void>>(Promise.resolve());
  const batches = useRef(0);
  const imageQueue = useRef<Promise<DraftImage[]>>(Promise.resolve([]));
  const shownKey = useRef(key);
  shownKey.current = key;
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
  // A refused paste leaves the draft as it was; the next edit moves on from it.
  useEffect(() => {
    setError((error) => (error === PASTE_TOO_LONG ? undefined : error));
  }, [text]);
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
  useEffect(() => {
    let live = true;
    const reload = () => {
      const loaded = loadDraftImages(key);
      imageQueue.current = loaded;
      void loaded.then((saved) => live && setImages(saved)).catch(() => {});
    };
    // Another window showing this thread sent, drew on or dropped its screenshots.
    const off = onDraftImagesChanged((changed) => {
      if (changed === key) reload();
    });
    // A paste can finish after this composer was closed and opened again.
    const offSaved = onDraftImagesSaved((changed, saved) => {
      if (changed !== key) return;
      imageQueue.current = Promise.resolve(saved);
      setImages(saved);
    });
    // A phone sent it through this computer, screenshots and all.
    const offTaken = onDraftTaken((thread) => {
      if (splitDraftKey(key)?.thread === thread) reload();
    });
    return () => {
      live = false;
      off();
      offSaved();
      offTaken();
    };
  }, [key]);
  // Screenshots pasted while others are still being prepared wait their turn,
  // so each batch counts the ones before it.
  function queueImages(attach: () => Promise<void>) {
    batches.current++;
    setPreparing(true);
    setError(undefined);
    preparation.current = preparation.current.then(attach).finally(() => {
      if (!--batches.current) setPreparing(false);
    });
  }
  function addImages(files: File[], point?: Point) {
    const arriving = files.map((file) => ({ file }));
    if (arriving.length) queueImages(() => attachImages(arriving, { point }));
  }
  /**
   * Screenshots arrive as files, each getting a pill where the pointer is or
   * at the caret, or with the `text` of a message they were copied from,
   * whose tokens say where their pills go. A text long enough to paste as a
   * pill goes in as one with its screenshots' pills after it, in token order:
   * a token inside a paste pill points at nothing.
   */
  async function attachImages(
    files: { file: File; n?: number }[],
    at: { point?: Point; text?: string },
  ) {
    try {
      const existing = await (shownKey.current === key
        ? imageQueue.current
        : loadDraftImages(key));
      // The draft as it is now, with the pills of any batch before this one.
      const text = readDraft(key);
      const kept = attachedImages(text, existing);
      // A screenshot shown twice in what was copied comes as one file.
      const unique = [...new Set(files.map(({ file }) => file))];
      if (kept.length + unique.length > 3)
        throw new Error("Attach up to three screenshots per message.");
      const first = nextImageNumber(text, existing);
      const long =
        at.text !== undefined &&
        isLongPaste(at.text) &&
        !pastedTexts(at.text).length;
      // A pill only means something next to words; pasted into a draft with
      // none, the screenshot just sits in the strip. Without a pill it has no
      // number, so it always goes along.
      const inText = imagePills && !onlyImageTokens(`${text} ${at.text ?? ""}`);
      const prepared = new Map(
        await Promise.all(
          unique.map(
            async (file) => [file, await prepareScreenshot(file)] as const,
          ),
        ),
      );
      const placed =
        at.text === undefined
          ? {
              text: undefined,
              images: unique.map((file, i) => {
                const image = prepared.get(file)!;
                return inText ? { ...image, n: first + i } : image;
              }),
            }
          : pastedImages(
              at.text,
              files.map(({ file, n }) => ({
                ...prepared.get(file)!,
                n: inText ? n : undefined,
              })),
              first - 1,
              (image) => image.id,
            );
      // Screenshots whose pills were deleted make room here, not on undo.
      const next = [...kept, ...placed.images];
      await saveDraftImages(key, next);
      // Numbered on in token order, so ascending is the order they sat in.
      const ns = placed.images
        .flatMap((image) => image.n ?? [])
        .sort((a, b) => a - b);
      const words =
        long && placed.text !== undefined
          ? withoutImageTokens(placed.text)
          : placed.text;
      const shown = shownKey.current === key;
      // Kept for the thread it was pasted in, even once another one shows.
      if (shown) {
        imageQueue.current = Promise.resolve(next);
        setImages(next);
      }
      const tokens = ns.map(imageToken).join(" ");
      const added =
        words === undefined
          ? tokens
          : long && tokens
            ? `${words} ${tokens}`
            : words;
      if (shown && editor.current) {
        if (words === undefined) editor.current.insertImages(ns, at.point);
        else if (
          words.trim() &&
          !(long
            ? editor.current.insertPaste(words)
            : editor.current.pasteText(words))
        ) {
          // The words don't fit, so their screenshots don't stay either.
          imageQueue.current = Promise.resolve(existing);
          setImages(existing);
          setError(PASTE_TOO_LONG);
          await saveDraftImages(key, existing).catch(() => {});
        } else if (long && ns.length) editor.current.insertImages(ns);
      } else if (added) {
        // Navigation clears the editor ref; its tokens must still be saved.
        const now = readDraft(key);
        writeDraft(key, `${now}${now ? " " : ""}${added}`);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not attach screenshot.",
      );
      // The copied message's words still land, without the pills that
      // would point at screenshots it didn't bring.
      if (at.text !== undefined) pasteWords(pastedImages(at.text, [], 0).text);
    }
  }
  function pasteWords(words: string) {
    if (!words.trim()) return;
    if (shownKey.current !== key || !editor.current) {
      const now = readDraft(key);
      writeDraft(key, `${now}${now ? " " : ""}${words}`);
    } else if (isLongPaste(words) && !pastedTexts(words).length) {
      if (!editor.current.insertPaste(words)) setError(PASTE_TOO_LONG);
    } else if (!editor.current.pasteText(words)) setError(PASTE_TOO_LONG);
  }
  /** Screenshots attach; any other file goes in as its path, which the agent reads itself. */
  function addFiles(files: File[], point?: Point) {
    const others = files.filter((file) => !isScreenshot(file));
    if (others.length) insertPaths(others, point);
    void addImages(files.filter(isScreenshot), point);
  }
  function insertPaths(files: File[], point?: Point) {
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
  /** Changes the screenshots `of` keeps, after any change still being saved, whether or not its thread still shows. */
  function editImages(
    of: string,
    change: (now: DraftImage[]) => DraftImage[],
    failed: string,
  ): Promise<unknown> {
    if (shownKey.current !== of)
      return loadDraftImages(of)
        .then((now) => saveDraftImages(of, change(now)))
        .catch(() => setError(failed));
    const edited = imageQueue.current.then(async (now) => {
      const next = change(now);
      setImages(next);
      await saveDraftImages(of, next).catch(() => setError(failed));
      return next;
    });
    imageQueue.current = edited;
    return edited;
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
    pasteRefused: () => setError(PASTE_TOO_LONG),
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
      // A message copied in Relay brings its screenshots and pills in its HTML.
      const html = event.clipboardData.getData("text/html");
      editor.current?.adoptPills(html);
      const copied = copiedImages(html);
      // Copied within this draft, its pills still have their screenshots.
      const ownPills = copied.every(({ n, src }) =>
        images.some((image) => image.n === n && image.dataUrl === src),
      );
      if (copied.length && !ownPills) {
        event.preventDefault();
        event.stopPropagation();
        const text = cleanPaste(event.clipboardData.getData("text/plain"));
        queueImages(() => attachImages(copied, { text }));
        return;
      }
      const files = event.clipboardData.files.length
        ? Array.from(event.clipboardData.files)
        : Array.from(event.clipboardData.items)
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
      // Files copied in Finder or Explorer paste like they drop.
      if (files.length) {
        event.preventDefault();
        event.stopPropagation();
        addFiles(files);
        return;
      }
      // A long paste becomes a pill at the caret instead of flooding the draft.
      const pasted = cleanPaste(event.clipboardData.getData("text/plain"));
      if (!isLongPaste(pasted) || pastedTexts(pasted).length) return;
      event.preventDefault();
      event.stopPropagation();
      setError(
        editor.current?.insertPaste(pasted) ? undefined : PASTE_TOO_LONG,
      );
    },
    drop(event: DragEvent) {
      const image = droppedImage(event.dataTransfer);
      const files = image ? [image] : Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      addFiles(files, { left: event.clientX, top: event.clientY });
    },
    /** The skills picked as pills that `text` still mentions. */
    skills: (text: string) => pickedSkills(text, draftChips(key).skills.load()),
    /**
     * Empties the composer as the message goes out; a message that is turned
     * down comes back, ahead of anything typed since.
     */
    take(withImages: boolean) {
      let taken: { text: string; images: DraftImage[] } | undefined;
      const takenIds = () => new Set(taken?.images.map((image) => image.id));
      return {
        dispatch() {
          taken = { text, images: withImages ? images : [] };
          set("");
          if (!withImages) return;
          setImages([]);
          // A screenshot pasted while this goes out starts a draft of its own.
          imageQueue.current = Promise.resolve([]);
        },
        restore() {
          if (!taken) return;
          const { text, images: back } = taken,
            typed = readDraft(key).trim();
          set(typed ? `${text.trimEnd()}\n\n${typed}` : text);
          if (!back.length) return;
          const ids = takenIds();
          void editImages(
            key,
            (now) => [...back, ...now.filter((image) => !ids.has(image.id))],
            "Could not put the screenshot back in the draft.",
          );
        },
        /** The message went: its screenshots' draft copies go, any pasted since stay. */
        async forget() {
          if (!taken?.images.length) return;
          const ids = takenIds();
          for (const id of ids) sketchHistories.current.delete(id);
          await editImages(
            key,
            (now) => now.filter((image) => !ids.has(image.id)),
            "Screenshot was sent, but its draft copy could not be cleared.",
          );
        },
      };
    },
  };
}
