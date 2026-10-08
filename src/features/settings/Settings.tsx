import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Account } from "../../../shared/types";
import type { SettingsCategory } from "../../lib/settings-page";
import { matches, searchWords, sections } from "./settings-search";
import { useLeaveOnEscape } from "./useLeaveOnEscape";
import { ErrorBox } from "../../ui/ui";
import { categoryOf } from "./sections/categories";
import { SearchResults } from "./sections/SearchResults";
import { SearchHighlight } from "./sections/SearchHighlight";
import { Setting } from "./sections/Setting";
import { SettingsNav } from "./sections/SettingsNav";
import { useAppearanceEntries } from "./sections/appearance";
import { projectEntries } from "./sections/projects";
import { useSettingsProject } from "../projects/ProjectSettings";
import { accountEntries } from "./sections/account";
import { useModelEntries } from "./sections/models";
import { integrationEntries } from "./sections/integrations";
import { pluginEntries } from "./sections/plugins";
import { phoneEntries } from "./sections/phone";
import { computerEntries } from "./sections/computers";
import { useDictationEntries } from "./sections/dictation";
import { useReadAloudEntries } from "./sections/read-aloud";
import { useShortcutEntries } from "./sections/shortcuts";
import { useAboutEntries } from "./sections/about";
import "./settings.css";

export type { SettingsCategory };

export function Settings({
  account,
  onClose,
  onDisconnect,
  onConnect,
  onOpenChat,
  initialCategory,
  projectId,
  initialQuery = "",
  onQueryChange,
  onWhere,
}: {
  initialCategory?: SettingsCategory;
  /** Only provided when opening settings from a project entry point. */
  projectId?: string;
  /** Kept by the shell while the settings page is closed. */
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
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
  const content = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => searchInput.current?.focus(), []);
  const [destination, setDestination] = useState<{
    category: SettingsCategory;
    entryId?: string;
  }>({ category: initialCategory ?? "appearance" });
  const category = destination.category;
  const [query, updateQuery] = useState(initialQuery);
  const [searching, setSearching] = useState(!initialCategory);
  function setQuery(value: string) {
    updateQuery(value);
    onQueryChange?.(value);
    setSearching(true);
  }
  // Escape clears the search, then leaves.
  useLeaveOnEscape(() => (query ? setQuery("") : onClose()));
  const [error, setError] = useState<unknown>();
  const project = useSettingsProject(account?.id, projectId);
  const appearance = useAppearanceEntries(),
    models = useModelEntries(setError),
    dictation = useDictationEntries(),
    readAloud = useReadAloudEntries(),
    shortcuts = useShortcutEntries(),
    about = useAboutEntries();
  const entries = [
    ...appearance,
    ...projectEntries(project),
    ...accountEntries({ account, onConnect, onDisconnect, setError }),
    ...models,
    ...integrationEntries(onConnect),
    ...pluginEntries(),
    ...phoneEntries(),
    ...computerEntries({ onOpenChat, onClose }),
    ...dictation,
    ...readAloud,
    ...shortcuts,
    ...about,
  ];

  const words = searchWords(query);
  const results = words.length
    ? entries.filter((e) => matches(e, words, categoryOf(e.category).label))
    : [];
  const current = categoryOf(category);
  const showResults = !!words.length && searching;
  const categoryResults = results.filter((e) => e.category === category);
  const targetId = destination.entryId ?? categoryResults[0]?.id;
  const where = showResults
    ? "Search results"
    : category === "project" && project
      ? `${project.name} settings`
      : current.label;
  useEffect(() => onWhere?.(where), [where, onWhere]);
  useLayoutEffect(() => {
    const pane = content.current;
    if (!pane) return;
    if (!showResults && words.length && targetId) {
      const target = Array.from(
        pane.querySelectorAll<HTMLElement>("[data-setting-id]"),
      ).find((element) => element.dataset.settingId === targetId);
      if (target) {
        // Scroll only the content pane; tall cards should land at their top.
        pane.scrollTop +=
          target.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          16;
        target.focus({ preventScroll: true });
        return;
      }
    }
    pane.scrollTop = 0;
  }, [destination, showResults, targetId, query]);

  function openCategory(id: SettingsCategory, entryId?: string) {
    setDestination({ category: id, entryId });
    setSearching(false);
  }

  return (
    <section className="settings-screen" aria-labelledby={headingId}>
      <SettingsNav
        headingId={headingId}
        inputRef={searchInput}
        query={query}
        setQuery={setQuery}
        category={category}
        projectId={projectId}
        results={words.length ? results : null}
        showResults={showResults}
        onShowResults={() => setSearching(true)}
        onPick={openCategory}
        onClose={onClose}
      />
      <main className="settings-pane">
        <header>
          <h3>{where}</h3>
          <p>
            {showResults
              ? `${results.length} ${results.length === 1 ? "setting" : "settings"} matching “${query.trim()}”`
              : current.description}
          </p>
          {!showResults && !!words.length && (
            <div className="settings-search-context">
              <span role="status">
                {categoryResults.length}{" "}
                {categoryResults.length === 1 ? "match" : "matches"} for “
                {query.trim()}”
              </span>
              <button type="button" onClick={() => setSearching(true)}>
                All search results
              </button>
            </div>
          )}
        </header>
        <div className="settings-content" ref={content}>
          {showResults ? (
            results.length ? (
              <SearchResults
                results={results}
                query={query}
                onOpen={(entry) => openCategory(entry.category, entry.id)}
              />
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
                  {section && (
                    <h5>
                      <SearchHighlight text={section} query={query} />
                    </h5>
                  )}
                  {list.map((e) => (
                    <Setting
                      key={e.id}
                      entry={e}
                      query={query}
                      matched={
                        !!words.length && matches(e, words, current.label)
                      }
                    />
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
