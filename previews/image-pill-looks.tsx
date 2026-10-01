// Screenshot pills: ways to show more of the picture, in the composer and the thread.
// Open http://127.0.0.1:5177/previews/image-pill-looks.html (?look=name)
import "./desktop-stub";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowUp, ImagePlus } from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/pasted-texts.css";
import "../src/components/settings.css";
import "./image-pill-looks.css";
import { initAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import {
  ComposerPromptInput,
  type ImageChip,
  type PromptInputHandle,
} from "../src/components/ComposerPromptInput";
import { UserText, type SentImage } from "../src/components/UserText";
import { ImageThumbnail } from "../src/components/ImagePreview";
import { attachedImages, onlyImageTokens } from "../src/lib/image-refs";

initAppearance();
initWindowFocus();

type Look = "current" | "big" | "tile" | "thumb";
const looks: { id: Look; label: string; note: string }[] = [
  {
    id: "current",
    label: "Current",
    note: "What ships now, with no preview styling on top: Bigger thumb, picked 2026-10-01. Before it, the pill was an 18px thumbnail, file name and size, even for a paste called image.png.",
  },
  {
    id: "big",
    label: "Bigger thumb",
    note: "The pill stays; its picture doubles. Pastes are just the picture, real file names keep their name.",
  },
  {
    id: "tile",
    label: "Tile",
    note: "No pill chrome: the screenshot itself sits in the line, about a third of the strip's size. Named files add a muted name.",
  },
  {
    id: "thumb",
    label: "Thumb only",
    note: "Every screenshot is just its picture, named or not; the name lives in the tooltip.",
  },
];

/** A file name nobody chose: a clipboard paste or a macOS screenshot's timestamp. */
const pastedName = /^(image|screenshot)(\.\w+)?$|^screenshot \d{4}-\d\d-\d\d at /i;

/** A mock app window, so thumbnails look like screenshots and not swatches. */
function drawShot(kind: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const g = canvas.getContext("2d")!;
  const dark = kind === 1;
  g.fillStyle = dark ? "#1d1f24" : "#f6f6f7";
  g.fillRect(0, 0, 1200, 760);
  g.fillStyle = dark ? "#26282e" : "#ebebee";
  g.fillRect(0, 0, 1200, 52);
  for (const [i, c] of ["#ff5f57", "#febc2e", "#28c840"].entries()) {
    g.fillStyle = c;
    g.beginPath();
    g.arc(26 + i * 22, 26, 7, 0, Math.PI * 2);
    g.fill();
  }
  if (kind === 0) {
    g.fillStyle = "#e4e4e8";
    g.fillRect(0, 52, 260, 708);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i === 2 ? "#3e63dd" : "#c9c9cf";
      g.fillRect(28, 96 + i * 46, i === 2 ? 170 : 130, 16);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = "#ffffff";
      g.fillRect(310, 96 + i * 120, 840, 96);
      g.fillStyle = "#9b9ba3";
      g.fillRect(340, 126 + i * 120, 320, 16);
      g.fillStyle = i % 2 ? "#d0d0d6" : "#30a46c";
      g.beginPath();
      g.roundRect(1060, 128 + i * 120, 60, 32, 16);
      g.fill();
    }
  } else if (kind === 1) {
    for (let i = 0; i < 16; i++) {
      g.fillStyle = ["#7aa2f7", "#9ece6a", "#bb9af7", "#565f89"][i % 4];
      g.fillRect(60 + (i % 3) * 40, 90 + i * 34, 200 + ((i * 97) % 500), 14);
    }
    g.fillStyle = "#e5484d";
    g.fillRect(0, 560, 1200, 200);
    g.fillStyle = "#ffffff";
    g.fillRect(40, 600, 520, 22);
    g.fillRect(40, 640, 800, 14);
  } else {
    g.fillStyle = "#ffffff";
    g.fillRect(40, 90, 1120, 630);
    [180, 260, 220, 340, 300, 420, 380, 460].forEach((h, i) => {
      g.fillStyle = i === 5 ? "#f76b15" : "#8da4ef";
      g.fillRect(110 + i * 128, 680 - h, 80, h);
    });
  }
  return canvas.toDataURL("image/png");
}

interface Shot {
  n: number;
  name: string;
  src: string;
  bytes: number;
}
const samples = [
  { name: "image.png", bytes: 412_000 },
  { name: "settings-mock.png", bytes: 655_000 },
  { name: "image.png", bytes: 298_000 },
].map((s, i) => ({ ...s, src: drawShot(i) }));

const sentImages = (
  shots: Omit<Shot, "n">[],
  prefix: string,
): SentImage[] =>
  shots.map((shot, i) => ({
    image: {
      id: `${prefix}${i}`,
      name: shot.name,
      mimeType: "image/png",
      sizeBytes: shot.bytes,
    },
    preview: {
      key: `${prefix}${i}`,
      name: shot.name,
      load: async () => shot.src,
    },
  }));
const thread = [
  {
    id: "a",
    text: "[Image #1] how can we compact this more? The header should match [Image #2]",
    images: sentImages([samples[0], samples[1]], "a"),
  },
  {
    id: "b",
    text: "[Image #1]",
    images: sentImages([samples[2]], "b"),
  },
];

/** Marks pills whose screenshot has no real name, read from their tooltip. */
function markPasted(root: HTMLElement) {
  for (const chip of root.querySelectorAll<HTMLElement>(
    ".composer-image-chip",
  )) {
    const name = chip.title.split(", sent as")[0];
    chip.toggleAttribute("data-pasted", pastedName.test(name));
  }
}

function readFile(file: File): Promise<Omit<Shot, "n">> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name || "image.png",
        src: String(reader.result),
        bytes: file.size,
      });
    reader.readAsDataURL(file);
  });
}

function Preview() {
  const params = new URLSearchParams(location.search);
  const [look, setLook] = useState<Look>(
    looks.find((l) => l.id === params.get("look"))?.id ?? "big",
  );
  const [grow, setGrow] = useState(params.get("grow") !== "0");
  const [strip, setStrip] = useState(params.get("strip") !== "0");
  const [draft, setDraft] = useState(
    "Make the cards look like [Image #1] but keep the spacing from [Image #2] ",
  );
  const [shots, setShots] = useState<Shot[]>(
    samples.slice(0, 2).map((s, i) => ({ ...s, n: i + 1 })),
  );
  const [viewing, setViewing] = useState<string>();
  const [peek, setPeek] = useState<{ src: string; left: number; bottom: number }>();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLElement | null>(null);
  const handle = useRef<PromptInputHandle>(null);
  const chips = useMemo<ImageChip[]>(() => shots, [shots]);
  const attached = attachedImages(draft, shots);
  const byKey = new Map(
    thread.flatMap((m) =>
      m.images.map((s, i) => [s.preview.key, m.images[i]] as const),
    ),
  );

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    markPasted(el);
    const observer = new MutationObserver(() => markPasted(el));
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || !grow) return;
    const over = (event: MouseEvent) => {
      const thumb =
        event.target instanceof Element &&
        event.target
          .closest(".composer-image-chip")
          ?.querySelector<HTMLImageElement>("img.composer-image-chip-thumb");
      if (!thumb) return setPeek(undefined);
      const rect = thumb.getBoundingClientRect();
      setPeek((last) =>
        last?.src === thumb.src
          ? last
          : {
              src: thumb.src,
              left: rect.left,
              bottom: innerHeight - rect.top + 6,
            },
      );
    };
    const out = () => setPeek(undefined);
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseleave", out);
    return () => {
      el.removeEventListener("mouseover", over);
      el.removeEventListener("mouseleave", out);
      setPeek(undefined);
    };
  }, [grow]);

  function update(next: { look?: Look; grow?: boolean; strip?: boolean }) {
    const state = { look, grow, strip, ...next };
    setLook(state.look);
    setGrow(state.grow);
    setStrip(state.strip);
    const query = new URLSearchParams({ look: state.look });
    if (!state.grow) query.set("grow", "0");
    if (!state.strip) query.set("strip", "0");
    history.replaceState(null, "", `?${query}`);
  }

  function add(files: Omit<Shot, "n">[]) {
    const top = Math.max(0, ...shots.map((s) => s.n)) + 1;
    const fresh = files.map((f, i) => ({ ...f, n: top + i }));
    setShots((s) => [...s, ...fresh]);
    handle.current?.insertImages(fresh.map((f) => f.n));
  }

  const opened = viewing ? byKey.get(viewing) : undefined;
  const openedSrc = opened
    ? samples.find((s) => s.name === opened.image.name)?.src
    : undefined;

  return (
    <div
      ref={root}
      className={`pill-looks look-${look}${grow ? " grow" : ""}${strip ? "" : " no-strip"}`}
      style={{ maxWidth: 760, margin: "28px auto", padding: "0 26px" }}
    >
      <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 14px" }}>
        Sample data · the real composer and sent-message pills. Paste your own
        screenshot into the composer to see a real paste.
      </p>
      <div
        style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
      >
        <div className="segmented settings-segmented">
          {looks.map((l) => (
            <button
              key={l.id}
              type="button"
              className={look === l.id ? "active" : ""}
              aria-pressed={look === l.id}
              onClick={() => update({ look: l.id })}
            >
              {l.label}
            </button>
          ))}
        </div>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={grow}
            onChange={(e) => update({ grow: e.target.checked })}
          />
          Grow on hover
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={strip}
            onChange={(e) => update({ strip: e.target.checked })}
          />
          Thumbnail strip
        </label>
      </div>
      <p style={{ color: "var(--muted)", margin: "10px 0 22px", minHeight: 20 }}>
        {looks.find((l) => l.id === look)!.note}
      </p>

      <section className="project-messages" style={{ marginBottom: 26 }}>
        {thread.map((m) => (
          <article
            key={m.id}
            className="project-message user"
            aria-label="Your message"
            style={{ marginBottom: 18 }}
          >
            <header>
              <strong>You</strong>
              <time>19:30</time>
            </header>
            {!onlyImageTokens(m.text) && (
              <UserText
                text={m.text}
                images={m.images}
                onOpenImage={setViewing}
              />
            )}
            {/* A message with no pills has only this to show its screenshots. */}
            <div
              className={`message-images${onlyImageTokens(m.text) ? " keep" : ""}`}
            >
              {m.images.map((s) => (
                <ImageThumbnail
                  key={s.preview.key}
                  image={s.preview}
                  onOpen={() => setViewing(s.preview.key)}
                />
              ))}
            </div>
          </article>
        ))}
      </section>

      <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
        {attached.length > 0 && (
          <div className="composer-images" aria-label="Attachments">
            {attached.map((shot) => (
              <div className="composer-image" key={shot.n}>
                <img src={shot.src} alt={shot.name} />
              </div>
            ))}
          </div>
        )}
        <ComposerPromptInput
          inputRef={input}
          handleRef={handle}
          draftKey="preview-image-pill-looks"
          value={draft}
          onChange={setDraft}
          onCursor={() => {}}
          images={chips}
          placeholder="Ask about the code, plan a change, or build something…"
          onPasteCapture={(event) => {
            const files = Array.from(event.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            void Promise.all(files.map(readFile)).then(add);
          }}
        />
        <div className="composer-tools">
          <button
            type="button"
            className="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => add([samples[2]])}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <ImagePlus size={15} /> Paste sample screenshot
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="primary send-message"
            aria-label="Send message"
            disabled
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </form>

      {peek && (
        <img
          className="pill-peek"
          src={peek.src}
          alt=""
          style={{ left: peek.left, bottom: peek.bottom }}
        />
      )}
      {opened && openedSrc && (
        <div
          role="dialog"
          aria-label={opened.image.name}
          onClick={() => setViewing(undefined)}
          style={{
            position: "fixed",
            inset: 0,
            background: "#0008",
            display: "grid",
            placeItems: "center",
            zIndex: 20,
          }}
        >
          <figure style={{ margin: 0, textAlign: "center", color: "#fff" }}>
            <img
              src={openedSrc}
              alt=""
              style={{ maxWidth: "70vw", maxHeight: "70vh", borderRadius: 10 }}
            />
            <figcaption style={{ marginTop: 8, fontSize: 12 }}>
              In Relay this is the image viewer · click to close
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
