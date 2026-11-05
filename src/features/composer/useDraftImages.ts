import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { attachedImages, dataUrlBytes } from "../../../shared/image-refs";
import { splitDraftKey } from "../../lib/thread-draft";
import {
  loadDraftImages,
  onDraftImagesChanged,
  onDraftImagesSaved,
  saveDraftImages,
  type DraftImage,
} from "../images/draft-images";
import type { Sketch, SketchHistory } from "../images/sketch";
import { onDraftTaken } from "./drafts";

/** Persisted screenshots, including edits and copies held while a message goes out. */
export function useDraftImages(
  key: string,
  text: string,
  setError: (error: string) => void,
) {
  const [images, setImages] = useState<DraftImage[]>([]);
  const imageQueue = useRef<Promise<DraftImage[]>>(Promise.resolve([]));
  const shownKey = useRef(key);
  shownKey.current = key;
  const [sketching, setSketching] = useState<string>();
  const sketchHistories = useRef(new Map<string, SketchHistory>());
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
  const isShown = () => shownKey.current === key;
  function reset(next: DraftImage[]) {
    imageQueue.current = Promise.resolve(next);
    setImages(next);
  }
  return {
    images,
    /** The screenshots that go with the message. */
    attached,
    /** The screenshots' pills, as the editor shows them. */
    chips,
    isShown,
    read: () => (isShown() ? imageQueue.current : loadDraftImages(key)),
    reset,
    async save(next: DraftImage[]) {
      await saveDraftImages(key, next);
      // Kept for the thread it was pasted in, even once another one shows.
      if (isShown()) reset(next);
    },
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
    removeImage({ id }: DraftImage) {
      keepImages(
        images.filter((image) => image.id !== id),
        "Could not remove screenshot from the draft.",
      );
    },
    /** Keeps send cleanup scoped to the screenshots that actually went out. */
    take: () =>
      takeImages(images, {
        queue: imageQueue,
        setImages,
        edit: (change, failed) => editImages(key, change, failed),
        histories: sketchHistories.current,
      }),
  };
}

/** A composer's screenshots, as a message going out takes them. */
interface TakenFrom {
  /** What the composer holds, after any change still being saved. */
  queue: RefObject<Promise<DraftImage[]>>;
  setImages: Dispatch<SetStateAction<DraftImage[]>>;
  /** Changes and saves what the draft keeps. */
  edit(
    change: (now: DraftImage[]) => DraftImage[],
    failed: string,
  ): Promise<unknown>;
  histories: Map<string, SketchHistory>;
}

/** `images` going out with a message, and what's left of them once it went or was refused. */
function takeImages(images: DraftImage[], from: TakenFrom) {
  let taken: DraftImage[] | undefined;
  const takenIds = () => new Set(taken?.map((image) => image.id));
  return {
    dispatch() {
      taken = images;
      // One pasted while the message was readied, or while it goes out,
      // stays for the next one.
      const ids = takenIds();
      const left = (now: DraftImage[]) =>
        now.filter((image) => !ids.has(image.id));
      from.queue.current = from.queue.current.then(left, () => []);
      from.setImages(left);
    },
    restore() {
      if (!taken?.length) return;
      const back = taken;
      const ids = takenIds();
      void from.edit(
        (now) => [...back, ...now.filter((image) => !ids.has(image.id))],
        "Could not put the screenshot back in the draft.",
      );
    },
    async forget() {
      if (!taken?.length) return;
      const ids = takenIds();
      for (const id of ids) from.histories.delete(id);
      await from.edit(
        (now) => now.filter((image) => !ids.has(image.id)),
        "Screenshot was sent, but its draft copy could not be cleared.",
      );
    },
  };
}
