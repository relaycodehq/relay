import { useEffect, useRef } from "react";

const isGif = (url: string) => /\.gif$/i.test(url);

/** A GIF's first frame, so a list or a thread of them isn't redrawn every frame. */
function Still({ url, alt }: { url: string; alt: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const image = new Image();
    image.src = url;
    image
      .decode()
      .then(() => {
        const c = canvas.current;
        if (!live || !c) return;
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        c.getContext("2d")?.drawImage(image, 0, 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return <canvas ref={canvas} role="img" aria-label={alt} />;
}

/** A meme's picture, with its caption on it; a GIF moves only while `play`. */
export function MemePicture({
  url,
  name,
  caption,
  play,
}: {
  url: string;
  name: string;
  caption?: string;
  play: boolean;
}) {
  const picture =
    isGif(url) && !play ? (
      <Still url={url} alt={name} />
    ) : (
      <img src={url} alt={name} draggable={false} />
    );
  if (!caption) return picture;
  return (
    <span className="meme-art">
      {picture}
      <span className="meme-caption" aria-hidden>
        {caption}
      </span>
    </span>
  );
}
