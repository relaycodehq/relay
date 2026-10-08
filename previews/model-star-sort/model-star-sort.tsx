import "../_shared/desktop-stub";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronDown, Search, Star } from "lucide-react";
import "../../src/styles.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import {
  modelKey,
  pickerRows,
  type PickerModel,
} from "../../src/features/agents/model-picker-catalog";
import "./model-star-sort.css";

initAppearance();
initWindowFocus();

const models: PickerModel[] = [
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1-Sol",
    description: "Latest workhorse model for coding and everyday work.",
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6-Astra",
    description: "Frontier intelligence for the most demanding work.",
  },
  {
    id: "gpt-6-sol",
    name: "GPT-6-Sol",
    description: "Previous generation workhorse model.",
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6-Luna",
    description: "Fast and affordable model for easier tasks.",
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6-Sol",
    description: "Older generation workhorse model.",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6-Terra",
    description: "Sample model for exploring the reorder.",
  },
].map((m) => ({ ...m, provider: "codex" }));
const initialFavorites = [models[0], models[1], models[3]].map(modelKey);
const variants = [
  {
    name: "Quick slide",
    time: "220 ms",
    description: "Rows slide straight into place. Fast, quiet, easy to track.",
  },
  {
    name: "Lift & glide",
    time: "380 ms",
    description:
      "The clicked row takes a small side-step while its neighbors make room.",
  },
  {
    name: "Fade through",
    time: "260 ms",
    description:
      "Moving rows fade out of their old positions and into their new ones.",
  },
];

function Preview() {
  const [variant, setVariant] = useState(0);
  const [favorites, setFavorites] = useState(initialFavorites);
  const [category, setCategory] = useState<"codex" | "favorites">("codex");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(modelKey(models[1]));
  const list = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, DOMRect>());
  const changed = useRef("");
  const animations = useRef<Animation[]>([]);
  const reducedMotion = useRef(matchMedia("(prefers-reduced-motion: reduce)"));
  const { rows: matchingRows } = pickerRows(models, {
    category,
    query,
    legacy: true,
    group: "",
    favorites,
    allowDefault: false,
  });
  const rows = matchingRows.filter((row) =>
    models.some((model) => modelKey(model) === modelKey(row)),
  );

  function stopAnimations() {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    list.current
      ?.querySelectorAll<HTMLElement>("[data-model]")
      .forEach((row) => {
        row.style.zIndex = "";
      });
  }
  function capture(id: string) {
    before.current = new Map(
      Array.from(
        list.current!.querySelectorAll<HTMLElement>("[data-model]"),
      ).map((row) => [row.dataset.model!, row.getBoundingClientRect()]),
    );
    changed.current = id;
  }
  function toggle(id: string) {
    capture(id);
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((key) => key !== id) : [...prev, id],
    );
  }
  useLayoutEffect(() => {
    stopAnimations();
    const previous = before.current;
    before.current = new Map();
    if (reducedMotion.current.matches || !previous.size) return;
    list.current
      ?.querySelectorAll<HTMLElement>("[data-model]")
      .forEach((row) => {
        const id = row.dataset.model!;
        const old = previous.get(id);
        if (!old) return;
        const dy = old.top - row.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        const active = id === changed.current;
        const duration = variant === 0 ? 220 : variant === 1 ? 380 : 260;
        let frames: Keyframe[];
        if (variant === 2) {
          frames = [
            { transform: `translateY(${dy}px)`, opacity: 1, offset: 0 },
            { transform: `translateY(${dy}px)`, opacity: 0, offset: 0.44 },
            { transform: "translateY(0)", opacity: 0, offset: 0.45 },
            { transform: "translateY(0)", opacity: 1, offset: 1 },
          ];
        } else if (variant === 1 && active) {
          frames = [
            { transform: `translateY(${dy}px)`, offset: 0 },
            {
              transform: `translate(8px, ${dy * 0.92}px) scale(.985)`,
              offset: 0.18,
            },
            {
              transform: `translate(8px, ${dy * 0.08}px) scale(.985)`,
              offset: 0.82,
            },
            { transform: "translate(0, 0) scale(1)", offset: 1 },
          ];
        } else {
          frames = [
            { transform: `translateY(${dy}px)` },
            { transform: "translateY(0)" },
          ];
        }
        row.style.zIndex = active ? "2" : "1";
        const animation = row.animate(frames, {
          duration,
          easing: "cubic-bezier(.2,.7,.2,1)",
        });
        animations.current.push(animation);
        animation.onfinish = () => {
          row.style.zIndex = "";
        };
      });
  }, [favorites, variant, category, query]);

  useEffect(() => {
    const media = reducedMotion.current;
    const stop = () => stopAnimations();
    media.addEventListener("change", stop);
    return () => {
      media.removeEventListener("change", stop);
      stopAnimations();
    };
  }, []);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const row = rows[Number(event.key) - 1];
      if (row) {
        event.preventDefault();
        setSelected(modelKey(row));
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [rows]);

  function reset() {
    stopAnimations();
    before.current.clear();
    setQuery("");
    setCategory("codex");
    setFavorites(initialFavorites);
    setSelected(modelKey(models[1]));
  }
  const current = models.find((m) => modelKey(m) === selected)!;
  return (
    <main className="sort-preview">
      <header>
        <p className="eyebrow">RELAY / INTERACTION PREVIEW · SAMPLE DATA</p>
        <h1>Star it. Watch it move.</h1>
        <p className="intro">
          Favorites sort to the top immediately. Pick a motion, then try
          starring an unstarred model.
        </p>
      </header>
      <nav className="variant-switch" aria-label="Reorder animation">
        {variants.map((option, index) => (
          <button
            key={option.name}
            aria-pressed={variant === index}
            onClick={() => {
              reset();
              setVariant(index);
            }}
          >
            <span className="variant-number">0{index + 1}</span>
            {option.name}
          </button>
        ))}
      </nav>
      <div className="motion-caption">
        <strong>{variants[variant].name}</strong>
        <span>{variants[variant].time}</span>
        <p>{variants[variant].description}</p>
      </div>
      <section className="picker-stage" aria-label="Sample model picker">
        <div className="model-picker-popup">
          <nav className="model-picker-rail" aria-label="Model category">
            <button
              className="model-provider-tab"
              aria-label="Favorites"
              aria-pressed={category === "favorites"}
              onClick={() => setCategory("favorites")}
            >
              <Star size={21} fill="currentColor" />
            </button>
            <button
              className="model-provider-tab"
              aria-label="Codex models"
              aria-pressed={category === "codex"}
              onClick={() => setCategory("codex")}
            >
              <ProviderIcon provider="codex" />
            </button>
          </nav>
          <div className="model-picker-content">
            <label className="model-picker-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                aria-label="Search models"
              />
            </label>
            <div className="model-picker-scroll" ref={list}>
              {rows.map((model, index) => {
                const id = modelKey(model),
                  favorite = favorites.includes(id);
                return (
                  <div className="model-picker-row" key={id} data-model={id}>
                    <button
                      className="preview-model-select model-picker-row-label"
                      aria-label={`Select ${model.name}`}
                      aria-pressed={selected === id}
                      onClick={() => setSelected(id)}
                    >
                      <span>{model.name}</span>
                      <small>
                        <ProviderIcon provider="codex" />
                        <span>{model.description}</span>
                      </small>
                    </button>
                    <div className="model-picker-row-actions">
                      {selected === id && (
                        <Check size={13} aria-label="Selected" />
                      )}
                      <kbd>⌘{index + 1}</kbd>
                      <button
                        className="model-favorite"
                        aria-label={`${favorite ? "Remove" : "Add"} ${model.name} ${favorite ? "from" : "to"} favorites`}
                        aria-pressed={favorite}
                        onClick={() => toggle(id)}
                      >
                        <Star
                          size={17}
                          fill={favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!rows.length && (
                <p className="model-picker-empty">
                  {query
                    ? "No matching models."
                    : "Star a model in Codex to add it here."}
                </p>
              )}
            </div>
            <div className="usage-footer">
              <div className="usage-meter-top">
                <span>Weekly</span>
                <span>Sample usage</span>
              </div>
              <div className="sample-meter">
                <span />
              </div>
              <div className="usage-meter-bottom">
                <span>On pace · 96% left</span>
                <span>Resets in 6d 19h</span>
              </div>
              <div className="usage-credits">
                <span>62,500 credits</span>
                <span>~15,625–81,250 messages</span>
              </div>
            </div>
          </div>
        </div>
        <div className="preview-composer">
          <ProviderIcon provider="codex" />
          <span>{current.name}</span>
          <ChevronDown size={14} />
          <span className="composer-divider" />
          <span className="muted">Medium</span>
        </div>
      </section>
      <footer className="preview-actions">
        <button
          onClick={() => {
            setCategory("codex");
            setQuery("");
            capture(modelKey(models[4]));
            setFavorites((prev) =>
              prev.includes(modelKey(models[4]))
                ? prev.filter((key) => key !== modelKey(models[4]))
                : [...prev, modelKey(models[4])],
            );
          }}
        >
          Demo a reorder
        </button>
        <button onClick={reset}>Reset sample</button>
        <p>
          Try rapid clicks, search, or the Favorites tab. Reduced motion is
          respected.
        </p>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
