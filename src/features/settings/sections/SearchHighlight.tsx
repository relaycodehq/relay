import { highlight } from "../settings-search";

export function SearchHighlight({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  return highlight(text, query).map((part, i) =>
    part.matched ? <mark key={i}>{part.text}</mark> : part.text,
  );
}
