import type { Ref } from "react";
import { ErrorBox, Spinner } from "../../ui/ui";
import type { Row, Section } from "./palette-sections";
import type { SearchMode } from "./types";

/** Each section with the position of its first row in the list of all rows. */
function withFirstIndex(sections: Section[]) {
  let first = 0;
  return sections.map((section) => {
    const placed = { section, first };
    first += section.rows.length;
    return placed;
  });
}

function SectionRows(props: {
  section: Section;
  first: number;
  activeIndex: number;
  onHover: (index: number) => void;
  onChoose: (row: Row) => void;
  onShowMore: (section: SearchMode) => void;
}) {
  const { section, first, activeIndex, onHover, onChoose, onShowMore } = props;
  return (
    <div>
      <div className="ps-section-label">
        {section.label}
        {section.busy && <Spinner size={11} steady />}
      </div>
      {section.rows.map((row, i) => {
        const index = first + i;
        return (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className="ps-row"
            data-active={index === activeIndex ? "" : undefined}
            onMouseMove={() => onHover(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChoose(row)}
          >
            {row.body}
          </button>
        );
      })}
      {!!section.more && section.more > 0 && (
        <button
          type="button"
          className="ps-more"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onShowMore(section.id)}
        >
          Show {section.more} more
        </button>
      )}
    </div>
  );
}

/** The palette's list: the sections that have rows or are still looking, and the notes when there are none. */
export function PaletteResults(props: {
  listRef: Ref<HTMLDivElement>;
  sections: Section[];
  activeIndex: number;
  indexing: boolean;
  fileListError?: { error: unknown; retry: () => void };
  /** What was typed, when nothing matches it. */
  nothingFoundFor?: string;
  onHover: (index: number) => void;
  onChoose: (row: Row) => void;
  onShowMore: (section: SearchMode) => void;
}) {
  const { listRef, sections, indexing, fileListError, nothingFoundFor } = props;
  return (
    <div
      ref={listRef}
      className="palette-body"
      role="listbox"
      aria-label="Results"
    >
      {fileListError && (
        <ErrorBox error={fileListError.error} retry={fileListError.retry} />
      )}
      {indexing && <p className="ps-empty">Indexing files…</p>}
      {withFirstIndex(sections)
        .filter(({ section }) => section.rows.length || section.busy)
        .map(({ section, first }) => (
          <SectionRows
            key={section.id}
            section={section}
            first={first}
            activeIndex={props.activeIndex}
            onHover={props.onHover}
            onChoose={props.onChoose}
            onShowMore={props.onShowMore}
          />
        ))}
      {nothingFoundFor !== undefined && (
        <p className="ps-empty">Nothing matches “{nothingFoundFor}”.</p>
      )}
    </div>
  );
}
