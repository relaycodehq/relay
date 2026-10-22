import type { ClipboardEvent, DragEvent, RefObject } from "react";
import {
  cleanPaste,
  isFilePaste,
  isLongPaste,
  nextPasteFile,
  pastedTexts,
} from "../../../shared/pasted-texts";
import {
  attachedImages,
  imageToken,
  nextImageNumber,
  onlyImageTokens,
  pastedImages,
  withoutImageTokens,
} from "../../../shared/image-refs";
import { api } from "../../lib/api";
import { draftChips } from "../../lib/thread-storage";
import { isScreenshot, prepareScreenshot } from "../images/draft-images";
import { copiedImages } from "../images/image-clipboard";
import { droppedImage } from "../images/image-drag";
import { readDraft, writeDraft } from "./drafts";
import { fileMarkdown } from "./prompt-text";
import type { useDraftImages } from "./useDraftImages";

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
  /** Replaces the selection with a saved paste's file pill; false when it cannot fit. */
  pasteFile: (path: string) => boolean;
  /** Puts a long paste at the caret as a pill; false when the message cannot hold it. */
  insertPaste: (text: string) => boolean;
  /** Replaces a range of the draft with plain text, or removes it, and puts the caret after it. */
  insertText: (range: { start: number; end: number; text: string }) => void;
  /** Takes on the pills copied `html` marks, before its text is pasted. */
  adoptPills: (html: string) => void;
}

export const PASTE_TOO_LONG =
  "That paste is too long. A message holds up to 32,000 characters.";

/** Files and pasted text entering one draft; queued work keeps its original key. */
export function draftIntake({
  key,
  editor,
  screenshots,
  imagePills,
  setError,
  queuePreparation,
}: {
  key: string;
  editor: RefObject<DraftEditor | null>;
  screenshots: Pick<
    ReturnType<typeof useDraftImages>,
    "images" | "read" | "save" | "reset" | "isShown"
  >;
  imagePills: boolean;
  setError: (error: string | undefined) => void;
  queuePreparation: (attach: () => Promise<void>) => void;
}) {
  function addImages(files: File[], point?: Point) {
    const arriving = files.map((file) => ({ file }));
    if (arriving.length)
      queuePreparation(() => attachImages(arriving, { point }));
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
      const existing = await screenshots.read();
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
      await screenshots.save(next);
      // Numbered on in token order, so ascending is the order they sat in.
      const ns = placed.images
        .flatMap((image) => image.n ?? [])
        .sort((a, b) => a - b);
      const words =
        long && placed.text !== undefined
          ? withoutImageTokens(placed.text)
          : placed.text;
      const shown = screenshots.isShown();
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
          screenshots.reset(existing);
          setError(PASTE_TOO_LONG);
          await screenshots.save(existing).catch(() => {});
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
    if (!screenshots.isShown() || !editor.current) {
      const now = readDraft(key);
      writeDraft(key, `${now}${now ? " " : ""}${words}`);
    } else if (isLongPaste(words) && !pastedTexts(words).length) {
      if (!editor.current.insertPaste(words)) setError(PASTE_TOO_LONG);
    } else if (!editor.current.pasteText(words)) setError(PASTE_TOO_LONG);
  }
  /**
   * A paste too big for the message, or big enough to cost the agent's
   * context for nothing, is saved as a file and goes in as its path, which
   * the agent reads as much of as it needs.
   */
  async function spillPaste(pasted: string) {
    setError(undefined);
    try {
      const path = await api.savePaste(pasted, nextPasteFile(readDraft(key)));
      if (screenshots.isShown() && editor.current) {
        if (!editor.current.pasteFile(path)) setError(PASTE_TOO_LONG);
      } else {
        const chips = draftChips(key).files;
        chips.save([...new Set([...chips.load(), path])]);
        const now = readDraft(key);
        writeDraft(key, `${now}${now ? " " : ""}${fileMarkdown(path)}`);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? `Could not save the paste: ${error.message}`
          : "Could not save the paste.",
      );
    }
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
  return {
    addFiles,
    /** Pasted text the message can't hold goes in as a file. */
    pasteRefused: (text: string) => {
      const pasted = cleanPaste(text);
      if (pasted) queuePreparation(() => spillPaste(pasted));
    },
    paste(event: ClipboardEvent) {
      // A message copied in Relay brings its screenshots and pills in its HTML.
      const html = event.clipboardData.getData("text/html");
      editor.current?.adoptPills(html);
      const copied = copiedImages(html);
      // Copied within this draft, its pills still have their screenshots.
      const ownPills = copied.every(({ n, src }) =>
        screenshots.images.some(
          (image) => image.n === n && image.dataUrl === src,
        ),
      );
      if (copied.length && !ownPills) {
        event.preventDefault();
        event.stopPropagation();
        const text = cleanPaste(event.clipboardData.getData("text/plain"));
        queuePreparation(() => attachImages(copied, { text }));
        return;
      }
      const files = event.clipboardData.files.length
        ? Array.from(event.clipboardData.files)
        : Array.from(event.clipboardData.items)
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
      // Files copied in Finder or Explorer paste like they drop. Files that
      // aren't on disk can't be mentioned, so the text they came with pastes.
      const placeable = files.some(
        (file) => isScreenshot(file) || api.pathForFile(file),
      );
      const plain = event.clipboardData.getData("text/plain");
      if (files.length && (placeable || !plain.trim())) {
        event.preventDefault();
        event.stopPropagation();
        addFiles(files);
        return;
      }
      // A long paste becomes a pill at the caret instead of flooding the
      // draft, and a huge one, or one the message can't hold, a file.
      const pasted = cleanPaste(plain);
      if (pastedTexts(pasted).length) return;
      const huge = isFilePaste(pasted);
      if (!huge && !isLongPaste(pasted)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!huge && editor.current?.insertPaste(pasted)) setError(undefined);
      else queuePreparation(() => spillPaste(pasted));
    },
    drop(event: DragEvent) {
      const image = droppedImage(event.dataTransfer);
      const files = image ? [image] : Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      addFiles(files, { left: event.clientX, top: event.clientY });
    },
  };
}
