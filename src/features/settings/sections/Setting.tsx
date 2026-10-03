import { highlight, type SettingEntry } from "../settings-search";

/** One setting: its title, with the search's word marked, and its control. */
export function Setting({
  entry,
  query,
}: {
  entry: SettingEntry;
  query: string;
}) {
  if (entry.card)
    return (
      <section className="setting card" aria-label={entry.title}>
        {entry.card(<Highlight text={entry.title} query={query} />)}
      </section>
    );
  const text = (
    <div className="setting-text">
      <h4>
        <Highlight text={entry.title} query={query} />
      </h4>
      {entry.description && <p>{entry.description}</p>}
    </div>
  );
  return (
    <section
      className={`setting ${entry.block ? "block" : ""}`}
      aria-label={entry.title}
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

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = highlight(text, query);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark>{parts[1]}</mark>
      {parts[2]}
    </>
  );
}
