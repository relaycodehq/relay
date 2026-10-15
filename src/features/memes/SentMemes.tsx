import { useMemo, useState } from "react";
import { memeToken, memeTokens, type MemeView } from "../../../shared/memes";
import { MemePicture } from "./MemePicture";
import { useMemes } from "./useMemes";
import "./memes.css";

type SentMeme = Pick<MemeView, "id" | "name" | "meaning" | "caption"> & {
  url: string;
};

/**
 * The memes in a sent message that this computer has pictures of, and the
 * text without them; one it has no picture of stays as the line it sent.
 */
export function useSentMemes(text: string | undefined) {
  const tokens = useMemo(() => (text ? memeTokens(text) : []), [text]);
  const memes = useMemes(tokens.length > 0);
  return useMemo(() => {
    if (!text || !tokens.length) return { memes: [], rest: text };
    const pictures = new Map(
      memes.data?.memes.flatMap((m) => (m.url ? [[m.id, m]] : [])),
    );
    const shown: SentMeme[] = [];
    let rest = "",
      at = 0;
    for (const t of tokens) {
      const m = pictures.get(t.id);
      if (!m?.url) continue;
      shown.push({
        id: t.id,
        name: m.name,
        meaning: t.meaning,
        url: m.url,
        ...(m.caption && { caption: m.caption }),
      });
      rest += text.slice(at, t.start);
      at = t.end;
    }
    rest += text.slice(at);
    return { memes: shown, rest: rest.trim() ? rest : "" };
  }, [text, tokens, memes.data]);
}

function Sent({ meme }: { meme: SentMeme }) {
  const [hover, setHover] = useState(false);
  return (
    <figure
      className="sent-meme"
      title={`The agent got: ${memeToken(meme)}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MemePicture
        url={meme.url}
        name={meme.name}
        caption={meme.caption}
        play={hover}
      />
      {!meme.caption && <figcaption>{meme.name}</figcaption>}
    </figure>
  );
}

/** The memes a message sent; a GIF plays while pointed at. */
export function SentMemes({ memes }: { memes: SentMeme[] }) {
  return (
    <div className="sent-memes">
      {memes.map((m, i) => (
        <Sent key={`${m.id}-${i}`} meme={m} />
      ))}
    </div>
  );
}
