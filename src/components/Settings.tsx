import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Account } from "../../shared/types";
import type { SettingsCategory } from "../lib/settings-page";
import { matches, searchWords, sections } from "../lib/settings-search";
import { useLeaveOnEscape } from "../lib/useLeaveOnEscape";
import { ErrorBox } from "./ui";
import { categories, categoryOf } from "./settings/categories";
import { Setting } from "./settings/Setting";
import { SettingsNav } from "./settings/SettingsNav";
import { useAppearanceEntries } from "./settings/appearance";
import { useProjectEntries } from "./settings/projects";
import { accountEntries } from "./settings/account";
import { useModelEntries } from "./settings/models";
import { integrationEntries } from "./settings/integrations";
import { pluginEntries } from "./settings/plugins";
import { roomEntries } from "./settings/rooms";
import { phoneEntries } from "./settings/phone";
import { computerEntries } from "./settings/computers";
import { useDictationEntries } from "./settings/dictation";
import { useShortcutEntries } from "./settings/shortcuts";
import { useAboutEntries } from "./settings/about";
import "./settings.css";

export type { SettingsCategory };

export function Settings({
  account,
  onClose,
  onDisconnect,
  onConnect,
  onOpenChat,
  initialCategory = "appearance",
  initialProject,
  onWhere,
}: {
  initialCategory?: SettingsCategory;
  /** The project Projects opens on; the first one otherwise. */
  initialProject?: string;
  /** Where Settings is, for the window title: a category or the search. */
  onWhere?: (label: string) => void;
  account: Account | null;
  onClose: () => void;
  onDisconnect: () => Promise<void>;
  onConnect?: () => void;
  /** Opens a thread, e.g. one listed under Computers. */
  onOpenChat?: (projectId: string, chatId: string) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  useEffect(() => searchInput.current?.focus(), []);
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const [query, setQuery] = useState("");
  // Escape clears the search, then leaves.
  useLeaveOnEscape(() => (query ? setQuery("") : onClose()));
  const [error, setError] = useState<unknown>();
  const appearance = useAppearanceEntries(),
    projects = useProjectEntries(account?.id, initialProject),
    models = useModelEntries(setError),
    dictation = useDictationEntries(),
    shortcuts = useShortcutEntries(),
    about = useAboutEntries();
  const entries = [
    ...appearance,
    ...projects,
    ...accountEntries({ account, onConnect, onDisconnect, setError }),
    ...models,
    ...integrationEntries(onConnect),
    ...pluginEntries(),
    ...roomEntries(),
    ...phoneEntries(),
    ...computerEntries({ onOpenChat, onClose }),
    ...dictation,
    ...shortcuts,
    ...about,
  ];

  const words = searchWords(query);
  const results = words.length
    ? entries.filter((e) => matches(e, words, categoryOf(e.category).label))
    : [];
  const current = categoryOf(category);
  const where = words.length ? "Search results" : current.label;
  useEffect(() => onWhere?.(where), [where]);

  return (
    <section className="settings-screen" aria-labelledby={headingId}>
      <SettingsNav
        headingId={headingId}
        inputRef={searchInput}
        query={query}
        setQuery={setQuery}
        category={category}
        results={words.length ? results : null}
        onPick={(id) => {
          setQuery("");
          setCategory(id);
        }}
        onClose={onClose}
      />
      <main className="settings-pane">
        <header>
          <h3>{where}</h3>
          <p>
            {words.length
              ? `${results.length} ${results.length === 1 ? "setting" : "settings"} matching “${query.trim()}”`
              : current.description}
          </p>
        </header>
        <div className="settings-content">
          {words.length ? (
            results.length ? (
              categories
                .filter((c) => results.some((e) => e.category === c.id))
                .map((c) => (
                  <div key={c.id} className="settings-group">
                    <h5>{c.label}</h5>
                    {results
                      .filter((e) => e.category === c.id)
                      .map((e) => (
                        <Setting key={e.id} entry={e} query={query} />
                      ))}
                  </div>
                ))
            ) : (
              <div className="settings-empty">
                <Search size={20} />
                <p>No settings match “{query.trim()}”.</p>
              </div>
            )
          ) : (
            sections(entries.filter((e) => e.category === category)).map(
              ({ section, list }, i) => (
                <div key={section ?? i} className="settings-group">
                  {section && <h5>{section}</h5>}
                  {list.map((e) => (
                    <Setting key={e.id} entry={e} query={query} />
                  ))}
                </div>
              ),
            )
          )}
          {!!error && <ErrorBox error={error} />}
        </div>
      </main>
    </section>
  );
}
