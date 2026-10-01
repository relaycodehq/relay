// Screenshots in the message: how an `[Image #n]` pill could look in the composer.
// Open http://127.0.0.1:5177/previews/image-pills.html (?look=name)
import "./desktop-stub";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, ImagePlus, X } from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/settings.css";
import { initAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import {
  ComposerPromptInput,
  type ImageChip,
  type PromptInputHandle,
} from "../src/components/ComposerPromptInput";
import { attachedImages, numberImages } from "../src/lib/image-refs";
import { formatSize } from "../src/lib/file-tree";

initAppearance();
initWindowFocus();

type Look = "number" | "name" | "compact" | "icon" | "only" | "off";
const looks: { id: Look; label: string; note: string }[] = [
  {
    id: "number",
    label: "Number",
    note: "Thumbnail, the number the agent sees, and the size. Strip stays above.",
  },
  {
    id: "name",
    label: "File name",
    note: "Picked and built. T3 Code's way: thumbnail, file name and size; the agent still reads [Image #n].",
  },
  {
    id: "compact",
    label: "Compact",
    note: "Thumbnail and #n only. Quietest in the text; the strip carries the detail.",
  },
  {
    id: "icon",
    label: "Icon",
    note: "No thumbnail in the text, an image icon like the file tag. The strip is the only picture.",
  },
  {
    id: "only",
    label: "Pills only",
    note: "No strip above. The pill is the attachment; hover it for a big preview.",
  },
  {
    id: "off",
    label: "Off",
    note: "The Settings switch turned off: screenshots only sit above the message, as before.",
  },
];

interface Sample extends ImageChip {
  n: number;
}
interface Shot {
  id: string;
  n?: number;
  name: string;
  src: string;
  bytes: number;
}

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
      g.fillStyle = "#d0d0d6";
      g.fillRect(340, 154 + i * 120, 220, 12);
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
    g.fillRect(40, 668, 700, 14);
  } else {
    g.fillStyle = "#ffffff";
    g.fillRect(40, 90, 1120, 630);
    const bars = [180, 260, 220, 340, 300, 420, 380, 460];
    bars.forEach((h, i) => {
      g.fillStyle = i === 5 ? "#f76b15" : "#8da4ef";
      g.fillRect(110 + i * 128, 680 - h, 80, h);
    });
    g.fillStyle = "#9b9ba3";
    g.fillRect(80, 120, 280, 20);
  }
  return canvas.toDataURL("image/png");
}

const samples = [
  { name: "image.png", bytes: 412_000 },
  { name: "Screenshot 2026-10-01 at 13.42.10.png", bytes: 655_000 },
  { name: "image.png", bytes: 298_000 },
].map((s, i) => ({ ...s, src: drawShot(i) }));

const params = new URLSearchParams(location.search);
const initialLook = (looks.find((l) => l.id === params.get("look"))?.id ??
  "name") as Look;

function seed(look: Look): { draft: string; shots: Shot[] } {
  const shots = samples
    .slice(0, 2)
    .map((s, i) => ({ ...s, id: crypto.randomUUID(), n: i + 1 }));
  if (look === "off")
    return {
      draft:
        "Make the settings page match the first screenshot, but keep the error banner from the second ",
      shots: shots.map(({ n: _, ...s }) => s),
    };
  return {
    draft:
      "Make the settings page match [Image #1] but keep the error banner from [Image #2] ",
    shots,
  };
}

const imageIcon = `url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2"/%3E%3Ccircle cx="9" cy="9" r="2"/%3E%3Cpath d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/%3E%3C/svg%3E') center/contain no-repeat`;

/** Redraws a real pill in the chosen look. The real one is "name". */
function restyle(chip: HTMLElement, look: Look, byN: Map<number, Shot>) {
  if (chip.classList.contains("missing")) return;
  const n = Number(chip.dataset.n),
    shot = byN.get(n);
  if (!shot || chip.firstElementChild?.getAttribute("data-look") === look)
    return;
  const el = (tag: string, cls: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const thumb = () => {
    const img = el("img", "composer-image-chip-thumb") as HTMLImageElement;
    img.src = shot.src;
    return img;
  };
  let parts: HTMLElement[];
  if (look === "number")
    parts = [
      thumb(),
      el("span", "", `Image #${n}`),
      el("span", "composer-image-chip-size", formatSize(shot.bytes)),
    ];
  else if (look === "compact") parts = [thumb(), el("span", "", `#${n}`)];
  else if (look === "icon") {
    const icon = el("span", "");
    Object.assign(icon.style, {
      width: "13px",
      height: "13px",
      flex: "none",
      background: "var(--muted)",
      mask: imageIcon,
    });
    parts = [icon, el("span", "", `Image #${n}`)];
  } else {
    chip.firstElementChild?.setAttribute("data-look", look);
    return;
  }
  parts[0].setAttribute("data-look", look);
  chip.replaceChildren(...parts);
}

function readFile(file: File): Promise<Omit<Shot, "id" | "n">> {
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
  const [look, setLook] = useState<Look>(initialLook);
  const [{ draft, shots }, setState] = useState(() => seed(initialLook));
  const [opened, setOpened] = useState<Shot>();
  const [hover, setHover] = useState<{
    shot: Shot;
    left: number;
    top: number;
  }>();
  const [error, setError] = useState<string>();
  const [epoch, setEpoch] = useState(0);
  const input = useRef<HTMLElement | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const handle = useRef<PromptInputHandle>(null);
  const byN = useMemo(
    () => new Map(shots.flatMap((s) => (s.n ? [[s.n, s] as const] : []))),
    [shots],
  );
  const attached = attachedImages(draft, shots);
  // A new array each time the look changes makes the real pills redraw first.
  const chips = useMemo<Sample[]>(
    () =>
      shots.flatMap(({ n, name, src, bytes }) =>
        n ? [{ n, name, src, bytes }] : [],
      ),
    [shots, look],
  );
  const lookRef = useRef(look);
  lookRef.current = look;
  const byNRef = useRef(byN);
  byNRef.current = byN;

  useEffect(() => {
    const root = form.current;
    if (!root) return;
    const apply = () =>
      root
        .querySelectorAll<HTMLElement>(".composer-image-chip")
        .forEach((chip) => restyle(chip, lookRef.current, byNRef.current));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [epoch, look, byN]);

  useEffect(() => {
    const root = form.current;
    if (!root || look !== "only") return;
    const over = (event: MouseEvent) => {
      const chip =
        event.target instanceof Element &&
        (event.target.closest(".composer-image-chip") as HTMLElement | null);
      const shot = chip && byNRef.current.get(Number(chip.dataset.n));
      if (!chip || !shot) return setHover(undefined);
      const rect = chip.getBoundingClientRect();
      setHover({ shot, left: rect.left, top: rect.top });
    };
    const out = () => setHover(undefined);
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseleave", out);
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseleave", out);
      setHover(undefined);
    };
  }, [look, epoch]);

  function pickLook(next: Look) {
    const leavingOff = look === "off" && next !== "off";
    setLook(next);
    history.replaceState(null, "", `?look=${next}`);
    if (next === "off" || leavingOff) {
      setState(seed(next));
      setEpoch((e) => e + 1);
    }
  }

  async function add(
    files: Omit<Shot, "id" | "n">[],
    point?: { left: number; top: number },
  ) {
    if (attached.length + files.length > 3) {
      setError("Attach up to three screenshots per message.");
      return;
    }
    setError(undefined);
    const top = Math.max(0, ...shots.map((s) => s.n ?? 0)) + 1;
    const fresh = files.map((f, i) => ({
      ...f,
      id: crypto.randomUUID(),
      ...(look === "off" ? {} : { n: top + i }),
    }));
    setState((s) => ({
      ...s,
      shots: [...attachedImages(draft, s.shots), ...fresh],
    }));
    if (look !== "off")
      handle.current?.insertImages(
        fresh.map((f) => f.n!),
        point,
      );
  }

  function remove(shot: Shot) {
    if (shot.n) handle.current?.removeImage(shot.n);
    setState((s) => ({ ...s, shots: s.shots.filter((x) => x.id !== shot.id) }));
  }

  const outgoing = numberImages(draft.trim(), shots);
  const strip = look !== "only" && attached.length > 0;

  return (
    <div style={{ maxWidth: 760, margin: "28px auto", padding: "0 26px" }}>
      <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 14px" }}>
        Sample data · the real composer input and pill. Paste or drop your own
        screenshot, type, backspace a pill, ⌘Z, × in the strip.
      </p>
      <div className="segmented settings-segmented" style={{ marginBottom: 8 }}>
        {looks.map((l) => (
          <button
            key={l.id}
            type="button"
            className={look === l.id ? "active" : ""}
            aria-pressed={look === l.id}
            onClick={() => pickLook(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p style={{ color: "var(--muted)", margin: "0 0 18px", minHeight: 20 }}>
        {looks.find((l) => l.id === look)!.note}
      </p>

      <form
        ref={form}
        className="project-composer"
        onSubmit={(e) => e.preventDefault()}
      >
        {strip && (
          <div className="composer-images" aria-label="Attachments">
            {attached.map((shot) => (
              <div className="composer-image" key={shot.id}>
                <button
                  type="button"
                  className="composer-image-open"
                  aria-label={`Draw on ${shot.name}`}
                  onClick={() => setOpened(shot)}
                >
                  <img src={shot.src} alt={shot.name} />
                </button>
                <button
                  type="button"
                  className="composer-image-remove"
                  aria-label={`Remove ${shot.name}`}
                  onClick={() => remove(shot)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="composer-image-error" role="alert">
            {error}
          </p>
        )}
        <ComposerPromptInput
          key={epoch}
          inputRef={input}
          handleRef={handle}
          draftKey={`preview-image-pills-${epoch}`}
          value={draft}
          onChange={(value) => setState((s) => ({ ...s, draft: value }))}
          onCursor={() => {}}
          images={chips}
          onOpenImage={(n) => setOpened(byN.get(n))}
          placeholder="Ask about the code, plan a change, or build something…"
          onPasteCapture={(event) => {
            const files = Array.from(event.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            void Promise.all(files.map(readFile)).then((read) => add(read));
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            const point = { left: event.clientX, top: event.clientY };
            void Promise.all(files.map(readFile)).then((read) =>
              add(read, point),
            );
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
        />
        <div className="composer-tools">
          <button
            type="button"
            className="ghost"
            title="Paste a sample screenshot at the caret"
            // Keeps the caret in the message, where the pill goes.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void add([samples[shots.length % samples.length]])}
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

      <section style={{ marginTop: 22 }}>
        <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}>
          What the agent gets
        </p>
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {outgoing.text || " "}
          {outgoing.images.map((shot, i) => `\n+ image ${i + 1}: ${shot.name}`)}
        </pre>
      </section>

      {hover && (
        <img
          src={hover.shot.src}
          alt=""
          style={{
            position: "fixed",
            left: hover.left,
            top: hover.top - 8,
            transform: "translateY(-100%)",
            width: 280,
            borderRadius: 9,
            border: "1px solid var(--border)",
            boxShadow: "0 10px 30px #0003",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      )}
      {opened && (
        <div
          role="dialog"
          aria-label={`Draw on ${opened.name}`}
          onClick={() => setOpened(undefined)}
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
              src={opened.src}
              alt=""
              style={{ maxWidth: "70vw", maxHeight: "70vh", borderRadius: 10 }}
            />
            <figcaption style={{ marginTop: 8, fontSize: 12 }}>
              In Relay this opens the drawing editor · click to close
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
