import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { FilePeek } from "./FilePeek";
import type { MentionItem } from "./mention-items";
import type { FileMentions } from "./useFileMentions";
import "./file-mentions.css";

const HEIGHT = 340;
const changeLetter = { modified: "M", added: "A", deleted: "D", conflict: "!" };

/** `text` with the characters at `positions` (counted from `offset`) marked. */
function Hits({
  text,
  positions,
  offset = 0,
}: {
  text: string;
  positions: number[];
  offset?: number;
}) {
  const hit = new Set(positions.map((p) => p - offset));
  if (!positions.length) return <>{text}</>;
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.hit === hit.has(i)) last.text += text[i];
    else parts.push({ text: text[i], hit: hit.has(i) });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <b key={i} className="mention-hit">
            {p.text}
          </b>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

const nameStart = (item: MentionItem) =>
  item.path.lastIndexOf("/", item.path.length - 2) + 1;

function Row({
  item,
  index,
  mentions,
  base,
}: {
  item: MentionItem;
  index: number;
  mentions: FileMentions;
  /** The folder being listed, which its rows don't repeat. */
  base: string;
}) {
  const start = nameStart(item);
  const name = item.path.slice(start);
  const folder = item.path.slice(base.length, start).replace(/\/$/, "");
  const selected = index === mentions.active;
  return (
    <>
      {item.section && <div className="mention-section">{item.section}</div>}
      <button
        type="button"
        id={`${mentions.id}-${index}`}
        role="option"
        aria-selected={selected}
        className={"mention-row" + (selected ? " selected" : "")}
        onMouseMove={() => mentions.setActive(index)}
        onClick={() => mentions.choose(item)}
      >
        <FileEntryIcon path={item.path} directory={item.dir} />
        <span className="mention-name">
          <Hits text={name} positions={item.positions} offset={start} />
        </span>
        {folder && (
          <span className="mention-folder">
            <Hits
              text={folder}
              positions={item.positions}
              offset={base.length}
            />
          </span>
        )}
        <span className="mention-trail">
          {item.count &&
            (item.count.changed
              ? `${item.count.files} · ${item.count.changed} changed`
              : item.count.files)}
          {item.change && (
            <span
              className={`mention-change ${item.change}`}
              title={item.change}
            >
              {changeLetter[item.change]}
            </span>
          )}
        </span>
      </button>
    </>
  );
}

/** Over the composer, or under it when there is no room above. */
function useBounds(visible: boolean, input: RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!visible) return;
    function measure() {
      const form = (
        input.current?.closest("form") ?? input.current
      )?.getBoundingClientRect();
      if (!form) return;
      const width = Math.min(form.width, innerWidth - 24);
      const above = form.top > HEIGHT + 16;
      setStyle({
        left: Math.max(12, Math.min(form.left, innerWidth - width - 12)),
        width,
        ...(above
          ? { bottom: innerHeight - form.top + 6 }
          : { top: form.bottom + 6 }),
        maxHeight: above ? Math.min(HEIGHT, form.top - 20) : HEIGHT,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, input]);
  return style;
}

function Hints({ total }: { total: number }) {
  return (
    <div className="mention-hints">
      <span>
        <kbd>→</kbd> open folder
      </span>
      <span>
        <kbd>←</kbd> back
      </span>
      <span>
        <kbd>↵</kbd> mention
      </span>
      <span className="mention-total">
        {total ? `${total.toLocaleString()} files` : ""}
      </span>
    </div>
  );
}

function Empty({ mentions }: { mentions: FileMentions }) {
  if (mentions.loading) return <p className="mention-empty">Reading files…</p>;
  if (mentions.error)
    return (
      <p className="mention-empty">This folder’s files can’t be listed.</p>
    );
  return (
    <p className="mention-empty">
      Nothing matches “{mentions.query.split("/").pop() || mentions.query}”.
    </p>
  );
}

/** The `@` menu: ranked files and folders, the selected one shown beside them. */
export function FileMentionMenu({
  mentions,
  input,
}: {
  mentions: FileMentions;
  input: RefObject<HTMLElement | null>;
}) {
  const { visible, active, id, items, query } = mentions;
  const style = useBounds(visible, input);
  useEffect(() => {
    if (visible)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, visible, id]);
  if (!visible) return null;
  const base = query.endsWith("/") && mentions.tree.has(query) ? query : "";
  return createPortal(
    <div
      className="mention-menu"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mention-split">
        <div id={id} role="listbox" aria-label="Files" className="mention-list">
          {items.map((item, index) => (
            <Row
              key={item.path}
              item={item}
              index={index}
              mentions={mentions}
              base={base}
            />
          ))}
          {!items.length && <Empty mentions={mentions} />}
        </div>
        <FilePeek
          where={mentions.where}
          item={mentions.selected}
          tree={mentions.tree}
        />
      </div>
      <Hints total={mentions.total} />
    </div>,
    document.body,
  );
}
