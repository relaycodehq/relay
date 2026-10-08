import type { SettingEntry } from "../settings-search";
import { SearchHighlight } from "./SearchHighlight";

/** One setting: its title, with the search's word marked, and its control. */
export function Setting({
  entry,
  query,
  matched = false,
}: {
  entry: SettingEntry;
  query: string;
  matched?: boolean;
}) {
  if (entry.card)
    return (
      <section
        className="setting card"
        aria-label={entry.title}
        data-setting-id={entry.id}
        data-search-match={matched || undefined}
        tabIndex={-1}
      >
        {entry.card(<SearchHighlight text={entry.title} query={query} />)}
      </section>
    );
  const text = (
    <div className="setting-text">
      <h4>
        <SearchHighlight text={entry.title} query={query} />
      </h4>
      {entry.description && (
        <p>
          <SearchHighlight text={entry.description} query={query} />
        </p>
      )}
    </div>
  );
  return (
    <section
      className={`setting ${entry.block ? "block" : ""}`}
      aria-label={entry.title}
      data-setting-id={entry.id}
      data-search-match={matched || undefined}
      tabIndex={-1}
    >
      {entry.accessory ? (
        <div className="setting-head">
          {text}
          {entry.accessory()}
        </div>
      ) : (
        text
      )}
      <div className="setting-control">{entry.render?.()}</div>
    </section>
  );
}
