import type { DragEvent } from "react";

/** A thread image dragged within Relay; it carries its pixels, not a path. */
const IMAGE_DRAG = "application/x-relay-image";

export function startImageDrag(event: DragEvent, source: string, name: string) {
  event.dataTransfer.setData(IMAGE_DRAG, JSON.stringify({ source, name }));
  event.dataTransfer.effectAllowed = "copy";
}

export const carriesImage = (data: DataTransfer) =>
  data.types.includes(IMAGE_DRAG) || data.types.includes("text/uri-list");

/**
 * The image a drop carries as a file: one of Relay's own, or any data-URL
 * `<img>` dragged off the page. Read during the drop event; it's empty after.
 */
export function droppedImage(data: DataTransfer): File | undefined {
  const own = data.getData(IMAGE_DRAG);
  if (own) {
    const { source, name } = JSON.parse(own) as {
      source: string;
      name: string;
    };
    return dataUrlFile(source, name);
  }
  const uri = data.getData("text/uri-list").split(/\r?\n/)[0] ?? "";
  return dataUrlFile(uri, "Image");
}

function dataUrlFile(url: string, name: string) {
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!match) return undefined;
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: match[1] });
}
