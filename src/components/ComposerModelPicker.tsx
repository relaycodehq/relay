// Adapted from T3 Code's chat model picker. See THIRD_PARTY_NOTICES.md.
import { Fragment, useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { Toolbar } from "@base-ui/react/toolbar";
import {
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Search,
  Star,
} from "lucide-react";
import { modelSchema, type ModelChoice } from "../../shared/settings";
import { OpenAI, ClaudeAI } from "../vendor/t3code/model-picker/ProviderIcons";
import { scoreModelPickerSearch } from "../vendor/t3code/model-picker/modelPickerSearch";
import "./composer-model-picker.css";

export type MessageProvider = "codex" | "claude" | "message";
type Category = MessageProvider | "favorites";
type Model = {
  provider: MessageProvider;
  id: string;
  name: string;
  legacy?: boolean;
  custom?: boolean;
};
const models: Model[] = [
  { provider: "codex", id: "gpt-6-astra", name: "GPT-6-Astra" },
  { provider: "codex", id: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
  { provider: "codex", id: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
  { provider: "codex", id: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
  { provider: "codex", id: "gpt-5.5", name: "GPT-5.5", legacy: true },
  { provider: "codex", id: "", name: "Codex default" },
  { provider: "claude", id: "", name: "Claude default" },
  { provider: "message", id: "", name: "Message only" },
];
const providerNames = { codex: "Codex", claude: "Claude", message: "No agent" };
const modelKey = (m: Model) => JSON.stringify([m.provider, m.id]);
const favoritesKey = "relay-model-favorites";
const customsKey = "relay-custom-codex-models";
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === "string" && v.length <= 200)
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export function ProviderIcon({ provider }: { provider: MessageProvider }) {
  return provider === "codex" ? (
    <OpenAI className="provider-glyph" aria-hidden />
  ) : provider === "claude" ? (
    <ClaudeAI className="provider-glyph" aria-hidden />
  ) : (
    <MessageSquare className="provider-glyph" aria-hidden />
  );
}
export function ComposerModelPicker({
  provider,
  choice,
  onSelect,
}: {
  provider: MessageProvider;
  choice: ModelChoice | undefined;
  onSelect: (provider: MessageProvider, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>(provider);
  const [query, setQuery] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [favorites, setFavorites] = useState(() => readList(favoritesKey));
  const [customs, setCustoms] = useState(() =>
    readList(customsKey).filter((id) => modelSchema.safeParse(id).success),
  );
  const search = useRef<HTMLInputElement>(null);
  const selectedKey = JSON.stringify([
    provider,
    provider === "codex" ? choice?.model || "" : "",
  ]);
  const catalog = [...models];
  for (const id of [...customs, choice?.model || ""]) {
    if (id && !catalog.some((m) => m.provider === "codex" && m.id === id))
      catalog.push({ provider: "codex", id, name: id, custom: true });
  }
  const current = catalog.find((m) => modelKey(m) === selectedKey)!;
  const rows = catalog
    .filter((m) => {
      if (category === "favorites") return favorites.includes(modelKey(m));
      return m.provider === category && (!m.legacy || legacy || query.trim());
    })
    .map((m, index) => ({
      model: m,
      index,
      score: scoreModelPickerSearch(
        {
          driverKind: m.provider,
          providerDisplayName: providerNames[m.provider],
          name: m.name,
          shortName: m.id,
          isFavorite: favorites.includes(modelKey(m)),
        },
        query,
      ),
    }))
    .filter((r) => r.score !== null)
    .sort((a, b) =>
      query.trim()
        ? a.score! - b.score! || a.index - b.index
        : Number(!!a.model.legacy) - Number(!!b.model.legacy) ||
          a.index - b.index,
    )
    .map((r) => r.model);
  const customId = query.trim();
  if (
    category === "codex" &&
    rows.length === 0 &&
    modelSchema.safeParse(customId).success
  )
    rows.push({
      provider: "codex",
      id: customId,
      name: customId,
      custom: true,
    });

  function select(m: Model) {
    if (m.custom && !customs.includes(m.id))
      setCustoms((ids) => [...ids, m.id].slice(-100));
    onSelect(m.provider, m.id);
    setOpen(false);
  }
  useEffect(() => {
    localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem(customsKey, JSON.stringify(customs));
  }, [customs]);
  function changeCategory(next: Category) {
    setCategory(next);
    setQuery("");
    setLegacy(false);
    requestAnimationFrame(() => search.current?.focus());
  }
  const legacyToggle = (
    <button
      type="button"
      className="model-legacy-toggle"
      aria-expanded={legacy}
      onClick={() => setLegacy((v) => !v)}
    >
      <span>
        Legacy models<small>1 model</small>
      </span>
      <ChevronRight size={15} className={legacy ? "expanded" : ""} />
    </button>
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCategory(provider);
          setQuery("");
          setLegacy(false);
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className="composer-control composer-model-trigger"
        aria-label="Choose model and provider"
        title={current.name}
        disabled={!choice}
      >
        <ProviderIcon provider={provider} />
        <span>{current.name}</span>
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            className="model-picker-popup"
            aria-label="Choose model and provider"
            initialFocus={search}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                const m = rows[Number(e.key) - 1];
                if (m) select(m);
              }
            }}
          >
            <Toolbar.Root
              className="model-picker-rail"
              orientation="vertical"
              aria-label="Model providers"
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  search.current?.focus();
                }
              }}
            >
              {(["favorites", "codex", "claude", "message"] as const).map(
                (tab) => (
                  <Toolbar.Button
                    type="button"
                    key={tab}
                    aria-label={
                      tab === "favorites"
                        ? "Favorites"
                        : tab === "message"
                          ? "Message only"
                          : providerNames[tab]
                    }
                    title={
                      tab === "favorites"
                        ? "Favorites"
                        : tab === "message"
                          ? "Message only · no agent"
                          : providerNames[tab]
                    }
                    className="model-provider-tab"
                    aria-pressed={category === tab}
                    onClick={() => changeCategory(tab)}
                  >
                    {tab === "favorites" ? (
                      <Star className="provider-glyph" fill="currentColor" />
                    ) : (
                      <ProviderIcon provider={tab} />
                    )}
                  </Toolbar.Button>
                ),
              )}
            </Toolbar.Root>
            <div className="model-picker-content">
              <Combobox.Root<string>
                inline
                open
                autoHighlight
                items={rows.map(modelKey)}
                filter={null}
                inputValue={query}
                onInputValueChange={setQuery}
                value={selectedKey}
                onValueChange={(key) => {
                  const m = rows.find((row) => modelKey(row) === key);
                  if (m) select(m);
                }}
              >
                <div className="model-picker-search">
                  <Search size={16} aria-hidden />
                  <Combobox.Input
                    ref={search}
                    aria-label="Search models"
                    placeholder="Search models…"
                    autoComplete="off"
                    spellCheck={false}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpen(false);
                      }
                    }}
                  />
                </div>
                <div className="model-picker-scroll">
                  <Combobox.List aria-label="Models">
                    {rows.map((m, index) => {
                      const key = modelKey(m),
                        favorite = favorites.includes(key);
                      return (
                        <Fragment key={key}>
                          {category === "codex" &&
                            !query.trim() &&
                            m.legacy &&
                            legacyToggle}
                          <Combobox.Item
                            data-default={
                              m.provider === "codex" && !m.id ? "" : undefined
                            }
                            onClick={() => {
                              if (selectedKey === key) select(m);
                            }}
                            value={key}
                            index={index}
                            className="model-picker-row"
                            aria-label={m.name}
                          >
                            <div className="model-picker-row-label">
                              <span>{m.name}</span>
                              <small>
                                <ProviderIcon provider={m.provider} />
                                {m.custom
                                  ? "Custom Codex model"
                                  : m.provider === "claude"
                                    ? "Claude · CLI default"
                                    : providerNames[m.provider]}
                              </small>
                            </div>
                            <div className="model-picker-row-actions">
                              {selectedKey === key && (
                                <Check size={12} aria-hidden />
                              )}
                              {index < 9 && (
                                <kbd>
                                  {navigator.platform.includes("Mac")
                                    ? "⌘"
                                    : "Ctrl "}
                                  {index + 1}
                                </kbd>
                              )}
                              {m.provider !== "message" && (
                                <button
                                  type="button"
                                  className="model-favorite"
                                  aria-label={`${favorite ? "Remove" : "Add"} ${m.name} ${favorite ? "from" : "to"} favorites`}
                                  aria-pressed={favorite}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key !== "Escape" && e.key !== "Tab")
                                      e.stopPropagation();
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFavorites((prev) =>
                                      favorite
                                        ? prev.filter((v) => v !== key)
                                        : [...prev, key].slice(-100),
                                    );
                                  }}
                                >
                                  <Star
                                    size={14}
                                    fill={favorite ? "currentColor" : "none"}
                                  />
                                </button>
                              )}
                            </div>
                          </Combobox.Item>
                        </Fragment>
                      );
                    })}
                  </Combobox.List>
                  {rows.length === 0 && (
                    <p className="model-picker-empty">
                      {category === "favorites" && !query
                        ? "Star models to keep them here."
                        : "No matching models."}
                    </p>
                  )}
                  {category === "codex" &&
                    !query.trim() &&
                    !legacy &&
                    legacyToggle}
                </div>
              </Combobox.Root>
              {category === "claude" && (
                <p className="model-picker-note">
                  Uses the model configured in your Claude CLI.
                </p>
              )}
              {category === "message" && (
                <p className="model-picker-note">
                  Send a message without running an agent.
                </p>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
