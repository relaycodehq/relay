import { ArrowRight } from "lucide-react";
import type { SettingEntry } from "../settings-search";
import { categories, fullLabel } from "./categories";
import { SearchHighlight } from "./SearchHighlight";

/** Search links to the real control in its full section. */
export function SearchResults({
  results,
  query,
  onOpen,
}: {
  results: SettingEntry[];
  query: string;
  onOpen: (entry: SettingEntry) => void;
}) {
  return categories
    .filter((category) => results.some((e) => e.category === category.id))
    .map((category) => (
      <div key={category.id} className="settings-group">
        <h5>
          <SearchHighlight text={fullLabel(category.id)} query={query} />
        </h5>
        {results
          .filter((e) => e.category === category.id)
          .map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="settings-result"
              onClick={() => onOpen(entry)}
              aria-label={`Open ${entry.title} in ${fullLabel(category.id)}`}
            >
              <span className="settings-result-text">
                <strong>
                  <SearchHighlight text={entry.title} query={query} />
                </strong>
                {entry.description && (
                  <span>
                    <SearchHighlight text={entry.description} query={query} />
                  </span>
                )}
                <small>
                  <SearchHighlight
                    text={[fullLabel(category.id), entry.section]
                      .filter(Boolean)
                      .join(" › ")}
                    query={query}
                  />
                </small>
              </span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
      </div>
    ));
}
