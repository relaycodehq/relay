// Adapted from T3 Code's chat model picker. See THIRD_PARTY_NOTICES.md.
import { Fragment, memo, useEffect, useRef, useState } from "react";
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
import { modelSchema } from "../../shared/settings";
import {
  agentName,
  agentProviders,
  agents,
  type AgentModel,
  type AgentProvider,
  reportsUsage,
  usageProviders,
  type UsageProvider,
} from "../../shared/agents";
import type { ProviderUsage } from "../../shared/provider-usage";
import {
  OpenAI,
  ClaudeAI,
  OpenCode,
} from "../vendor/t3code/model-picker/ProviderIcons";
import { scoreModelPickerSearch } from "../vendor/t3code/model-picker/modelPickerSearch";
import { api } from "../lib/api";
import { keys } from "../lib/mod-key";
import { UsageMeters } from "./UsageMeters";
import "./composer-model-picker.css";

export type MessageProvider = AgentProvider | "message";
type Category = MessageProvider | "favorites";
type Model = {
  provider: MessageProvider;
  id: string;
  name: string;
  legacy?: boolean;
  custom?: boolean;
  description?: string;
  /** Its section, e.g. the upstream provider an OpenCode model runs on. */
  group?: string;
};
/** What the picker offers for one agent. */
export interface AgentCatalog {
  /** Listed by the agent; undefined while loading. */
  models: AgentModel[] | undefined;
  /** The model picked for it; "" is its Default. */
  model: string;
}
const providerNames: Record<MessageProvider, string> = {
  ...(Object.fromEntries(
    agentProviders.map((p) => [p, agentName(p)]),
  ) as Record<AgentProvider, string>),
  message: "No agent",
};
/** Search scores from here per word come from fuzzy matches; see modelPickerSearch. */
const fuzzyScore = 100;
const searchWords = (query: string) =>
  Math.max(1, query.trim().split(/\s+/).filter(Boolean).length);
const modelKey = (m: Model) => JSON.stringify([m.provider, m.id]);
const favoritesKey = "relay-model-favorites";
const customsKey = (provider: AgentProvider) =>
  `relay-custom-${provider}-models`;
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
const readCustoms = () =>
  Object.fromEntries(
    agentProviders.map((p) => [
      p,
      readList(customsKey(p)).filter((id) => modelSchema.safeParse(id).success),
    ]),
  ) as Record<AgentProvider, string[]>;
const providerIcons: Record<MessageProvider, typeof OpenAI> = {
  codex: OpenAI,
  claude: ClaudeAI,
  opencode: OpenCode,
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
}: {
  provider: MessageProvider;
  /** False until the agent's settings have loaded. */
  ready?: boolean;
  catalogs: Partial<Record<AgentProvider, AgentCatalog>>;
  onOpen?: () => void;
  onSelect: (provider: MessageProvider, model: string) => void;
  /** Limits the rail to these agents, without favorites or message-only. */
  providers?: AgentProvider[];
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
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>(provider);
  const [query, setQuery] = useState("");
  const [legacy, setLegacy] = useState(false);
  /** The section shown in a grouped agent's list; "" shows them all. */
  const [group, setGroup] = useState("");
  const [favorites, setFavorites] = useState(() => readList(favoritesKey));
  const [customs, setCustoms] = useState(readCustoms);
  const search = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<
    Partial<Record<UsageProvider, ProviderUsage>>
  >({});
  const [now, setNow] = useState(() => Date.now());
  const offered = (providers ?? agentProviders).filter((p) => catalogs[p]);
  const selectedKey = JSON.stringify([
    provider,
    provider === "message" ? "" : (catalogs[provider]?.model ?? ""),
  ]);
  const defaultName = (m: Model) =>
    m.provider !== "message" && !m.id ? defaultNames?.[m.provider] : undefined;
  // Each agent's listed models sit above its Default, then ids it doesn't
  // list: typed-in custom ones, and the pick itself.
  const catalog: Model[] = [
    ...offered.flatMap((p): Model[] => {
      const listed = catalogs[p]!.models ?? [];
      const unlisted = [...customs[p], catalogs[p]!.model].filter(
        (id, i, all) =>
          id && all.indexOf(id) === i && !listed.some((m) => m.id === id),
      );
      return [
        ...listed.map((m) => ({
          provider: p,
          id: m.id,
          name: m.name,
          description: m.description,
          legacy: m.legacy,
          group: m.group,
        })),
        { provider: p, id: "", name: `${agentName(p)} default` },
        ...unlisted.map((id) => ({
          provider: p,
          id,
          name: id,
          custom: customs[p].includes(id),
        })),
      ];
    }),
    { provider: "message", id: "", name: "Message only" },
  ];
  const legacyCount = catalog.filter(
    (m) => m.provider === category && m.legacy,
  ).length;
  const current =
    catalog.find((m) => modelKey(m) === selectedKey) ??
    catalog.find((m) => m.provider === provider && !m.id)!;
  const currentDefault = defaultName(current);
  const triggerName = currentDefault
    ? `Default (${currentDefault})`
    : current.name;
  // An agent with hundreds of models from many providers lists them by provider.
  const grouped =
    category !== "favorites" &&
    category !== "message" &&
    agents[category].modelGroups;
  const matching = catalog
    .filter((m) => allowDefault || m.provider === "message" || m.id)
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
          subProvider: [m.group, m.description].filter(Boolean).join(" "),
          isFavorite: favorites.includes(modelKey(m)),
        },
        query,
      ),
    }))
    // Among hundreds of models a fuzzy match is noise, and would skew the counts.
    .filter(
      (r) =>
        r.score !== null &&
        (!grouped || r.score < fuzzyScore * searchWords(query)),
    );
  const groups = grouped
    ? [
        ...new Set(
          catalog.flatMap((m) =>
            m.provider === category && m.group ? [m.group] : [],
          ),
        ),
      ].map((name) => ({
        name,
        count: matching.filter((r) => r.model.group === name).length,
      }))
    : [];
  const rows = matching
    .filter((r) => !grouped || !group || r.model.group === group)
    .sort((a, b) =>
      query.trim()
        ? a.score! - b.score! || a.index - b.index
        : Number(!!a.model.legacy) - Number(!!b.model.legacy) ||
          a.index - b.index,
    )
    .map((r) => r.model);
  const customId = query.trim();
  if (
    category !== "favorites" &&
    category !== "message" &&
    rows.length === 0 &&
    modelSchema.safeParse(customId).success
  )
    rows.push({
      provider: category,
      id: customId,
      name: customId,
      custom: true,
    });

  function select(m: Model) {
    const p = m.provider;
    if (m.custom && p !== "message" && !customs[p].includes(m.id))
      setCustoms((all) => ({ ...all, [p]: [...all[p], m.id].slice(-100) }));
    onSelect(m.provider, m.id);
    setOpen(false);
  }
  useEffect(() => {
    localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    for (const p of agentProviders)
      localStorage.setItem(customsKey(p), JSON.stringify(customs[p]));
  }, [customs]);
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    for (const provider of usageProviders) {
      void api
        .providerUsage(provider)
        .then((value) => {
          if (!cancel) setUsage((prev) => ({ ...prev, [provider]: value }));
        })
        .catch(() => {
          if (!cancel) {
            setUsage((prev) => ({
              ...prev,
              [provider]: {
                provider,
                windows: [],
                message: "Couldn't read usage",
              },
            }));
          }
        });
    }
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      cancel = true;
      clearInterval(tick);
    };
  }, [open]);
  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    onOpen?.();
    setCategory(provider);
    openGroup(provider);
    setQuery("");
    setLegacy(false);
    // Only a new signal opens the picker, not a changed provider.
  }, [openSignal]);
  /** What a row says under its name; nothing, for a plain model in its own section. */
  const subtitle = (m: Model) =>
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
                              {!query.trim() && m.legacy && legacyToggle}
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
                        !catalogs[category]?.models && (
                          <p className="model-picker-note">
                            Loading models from {agentName(category)}…
                          </p>
                        )}
                      {rows.length === 0 && (
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
              {reportsUsage(category) && (
                <UsageMeters usage={usage[category]} now={now} />
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
});
