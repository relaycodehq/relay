// Adapted from T3 Code's chat model picker. See THIRD_PARTY_NOTICES.md.
import {
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import {
  agentName,
  agentProviders,
  type AgentProvider,
  reportsUsage,
  type UsageProvider,
} from "../../../shared/agents";
import {
  OpenAI,
  ClaudeAI,
  OpenCode,
} from "../../vendor/t3code/model-picker/ProviderIcons";
import { keys } from "../../lib/mod-key";
import { CursorGlyph } from "./CursorGlyph";
import { UsageMeters } from "./UsageMeters";
import {
  isGrouped,
  modelKey,
  pickerCatalog,
  pickerRows,
  providerNames,
  type AgentCatalog,
  type Category,
  type MessageProvider,
  type PickerModel,
} from "./model-picker-catalog";
import { usePickerUsage } from "./usePickerUsage";
import { useCustomModels, useFavoriteModels } from "./useStoredModels";
import "./composer-model-picker.css";

const providerIcons: Record<MessageProvider, typeof OpenAI> = {
  codex: OpenAI,
  claude: ClaudeAI,
  opencode: OpenCode,
  cursor: CursorGlyph,
  message: MessageSquare,
};
export function ProviderIcon({ provider }: { provider: MessageProvider }) {
  const Glyph = providerIcons[provider];
  return <Glyph className="provider-glyph" aria-hidden />;
}
export const ComposerModelPicker = memo(function ComposerModelPicker({
  provider,
  ready = true,
  catalogs,
  onOpen,
  onSelect,
  providers,
  allowDefault = true,
  label,
  container,
  openSignal,
  defaultNames,
  account,
}: {
  provider: MessageProvider;
  /** False until the agent's settings have loaded. */
  ready?: boolean;
  catalogs: Partial<Record<AgentProvider, AgentCatalog>>;
  onOpen?: () => void;
  onSelect: (provider: MessageProvider, model: string) => void;
  /** Limits the rail to these agents, without favorites or message-only. */
  providers?: readonly AgentProvider[];
  /** Offers each agent's Default row. */
  allowDefault?: boolean;
  /** Names the trigger, e.g. "Grouping" gives "Grouping model". */
  label?: string;
  /** Portal target, needed inside a modal <dialog>'s top layer. */
  container?: HTMLElement;
  /** Opens the picker whenever this changes, e.g. from a /model command. */
  openSignal?: number;
  /** The model each agent's Default runs, where known. */
  defaultNames?: Partial<Record<AgentProvider, string>>;
  /**
   * The thread's account for each agent, whose usage the footer shows, and
   * a footer of its own where there are several to switch between.
   */
  account?: {
    of: (provider: UsageProvider) => string | undefined;
    footer: (provider: UsageProvider, now: number) => ReactNode;
  };
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>(provider);
  const [query, setQuery] = useState("");
  const [legacy, setLegacy] = useState(false);
  /** The section shown in a grouped agent's list; "" shows them all. */
  const [group, setGroup] = useState("");
  const [favorites, setFavorites] = useFavoriteModels();
  // Favorites lead the list in the order they had when the picker opened,
  // so starring a row doesn't move it out from under the pointer.
  const [pinned, setPinned] = useState(favorites);
  const [customs, setCustoms] = useCustomModels();
  const search = useRef<HTMLInputElement>(null);
  const { usage, now } = usePickerUsage(open, account?.of);
  const offered = (providers ?? agentProviders).filter((p) => catalogs[p]);
  const selectedKey = JSON.stringify([
    provider,
    provider === "message" ? "" : (catalogs[provider]?.model ?? ""),
  ]);
  const defaultName = (m: PickerModel) =>
    m.provider !== "message" && !m.id ? defaultNames?.[m.provider] : undefined;
  const catalog = pickerCatalog(offered, catalogs, customs);
  const current =
    catalog.find((m) => modelKey(m) === selectedKey) ??
    catalog.find((m) => m.provider === provider && !m.id)!;
  const currentDefault = defaultName(current);
  const triggerName = currentDefault
    ? `Default (${currentDefault})`
    : current.name;
  const grouped = isGrouped(category);
  const { rows, groups, legacyCount, firstLegacy } = pickerRows(catalog, {
    category,
    query,
    legacy,
    group,
    favorites,
    pinned,
    allowDefault,
  });

  function select(m: PickerModel) {
    const p = m.provider;
    if (m.custom && p !== "message" && !customs[p].includes(m.id))
      setCustoms((all) => ({ ...all, [p]: [...all[p], m.id].slice(-100) }));
    onSelect(m.provider, m.id);
    setOpen(false);
  }
  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    setPinned(favorites);
    onOpen?.();
    setCategory(provider);
    openGroup(provider);
    setQuery("");
    setLegacy(false);
    // Only a new signal opens the picker, not a changed provider.
  }, [openSignal]);
  /** What a row says under its name; nothing, for a plain model in its own section. */
  const subtitle = (m: PickerModel) =>
    m.custom && m.provider !== "message"
      ? `Custom ${agentName(m.provider)} model`
      : defaultName(m)
        ? `Runs ${defaultName(m)}`
        : grouped
          ? [group ? undefined : m.group, m.description]
              .filter(Boolean)
              .join(" · ")
          : m.description || providerNames[m.provider];
  // Opens on the section of the model in use, so it shows among its neighbours.
  const openGroup = (next: Category) =>
    setGroup(
      catalog.find((m) => m.provider === next && modelKey(m) === selectedKey)
        ?.group ?? "",
    );
  function changeQuery(next: string) {
    // A search looks everywhere; a provider can narrow it after.
    if (next.trim() && !query.trim()) setGroup("");
    setQuery(next);
  }
  function changeCategory(next: Category) {
    setCategory(next);
    openGroup(next);
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
        Legacy models
        <small>
          {legacyCount} model{legacyCount === 1 ? "" : "s"}
        </small>
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
          setPinned(favorites);
          onOpen?.();
          setCategory(provider);
          openGroup(provider);
          setQuery("");
          setLegacy(false);
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className="composer-control composer-model-trigger"
        aria-label={label ? `${label} model` : "Choose model and provider"}
        title={triggerName}
        disabled={!ready}
      >
        <ProviderIcon provider={provider} />
        <span>{triggerName}</span>
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          positionMethod={container ? "fixed" : "absolute"}
        >
          <Popover.Popup
            className="model-picker-popup"
            data-wide={grouped ? "" : undefined}
            aria-label={label ? `${label} model` : "Choose model and provider"}
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
            {(providers ? offered.length : 2) > 1 && (
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
                {(providers
                  ? offered
                  : (["favorites", ...offered, "message"] as const)
                ).map((tab) => (
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
                ))}
              </Toolbar.Root>
            )}
            <div className="model-picker-content">
              <div className="model-picker-list">
                <Combobox.Root<string>
                  inline
                  open
                  autoHighlight
                  items={rows.map(modelKey)}
                  filter={null}
                  inputValue={query}
                  onInputValueChange={changeQuery}
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
                  <div className="model-picker-columns">
                    {grouped && (
                      <nav
                        className="model-picker-groups"
                        aria-label={`${providerNames[category as AgentProvider]} providers`}
                      >
                        {[
                          {
                            name: "",
                            count: groups.reduce((n, g) => n + g.count, 0),
                          },
                          ...groups,
                        ].map((g) => (
                          <button
                            key={g.name}
                            type="button"
                            aria-pressed={group === g.name}
                            disabled={!!query.trim() && !g.count}
                            onClick={() => {
                              setGroup(g.name);
                              search.current?.focus();
                            }}
                          >
                            <span>{g.name || "All"}</span>
                            {catalogs[category as AgentProvider]?.models && (
                              <small>{g.count}</small>
                            )}
                          </button>
                        ))}
                      </nav>
                    )}
                    <div className="model-picker-scroll">
                      <Combobox.List aria-label="Models">
                        {rows.map((m, index) => {
                          const key = modelKey(m),
                            favorite = favorites.includes(key);
                          return (
                            <Fragment key={key}>
                              {index === firstLegacy && legacyToggle}
                              <Combobox.Item
                                // A default that knows its model shows it like any other row.
                                data-default={
                                  m.provider !== "message" &&
                                  !m.id &&
                                  !defaultName(m)
                                    ? ""
                                    : undefined
                                }
                                onClick={() => {
                                  if (selectedKey === key) select(m);
                                }}
                                value={key}
                                index={index}
                                className="model-picker-row"
                                data-compact={subtitle(m) ? undefined : ""}
                                aria-label={m.name}
                              >
                                <div className="model-picker-row-label">
                                  <span>{m.name}</span>
                                  {subtitle(m) && (
                                    <small>
                                      <ProviderIcon provider={m.provider} />
                                      <span>{subtitle(m)}</span>
                                    </small>
                                  )}
                                </div>
                                <div className="model-picker-row-actions">
                                  {selectedKey === key && (
                                    <Check size={12} aria-hidden />
                                  )}
                                  {index < 9 && (
                                    <kbd>
                                      {keys("⌘", "Ctrl ")}
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
                                        if (
                                          e.key !== "Escape" &&
                                          e.key !== "Tab"
                                        )
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
                                        fill={
                                          favorite ? "currentColor" : "none"
                                        }
                                      />
                                    </button>
                                  )}
                                </div>
                              </Combobox.Item>
                            </Fragment>
                          );
                        })}
                      </Combobox.List>
                      {category !== "favorites" &&
                        category !== "message" &&
                        (catalogs[category]?.error ? (
                          <p className="model-picker-note" role="alert">
                            Couldn't load models from {agentName(category)}:{" "}
                            {catalogs[category].error}{" "}
                            {onOpen && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={onOpen}
                              >
                                Try again
                              </button>
                            )}
                          </p>
                        ) : (
                          !catalogs[category]?.models && (
                            <p className="model-picker-note">
                              Loading models from {agentName(category)}…
                            </p>
                          )
                        ))}
                      {rows.length === 0 &&
                        !catalogs[category as AgentProvider]?.error && (
                          <p className="model-picker-empty">
                            {category === "favorites" && !query
                              ? "Star models to keep them here."
                              : "No matching models."}
                          </p>
                        )}
                      {!query.trim() &&
                        !legacy &&
                        legacyCount > 0 &&
                        legacyToggle}
                    </div>
                  </div>
                </Combobox.Root>
              </div>
              {reportsUsage(category) &&
                (account?.footer(category, now) ?? (
                  <UsageMeters usage={usage[category]} now={now} />
                ))}
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
});
