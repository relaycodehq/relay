import { nativeImage } from "electron";

/**
 * A screenshot is a few MB as a data URL and a phone shows it 88 points wide
 * in a strip; on a slow link that's most of what opening a thread costs.
 * JPEGs stay JPEG; anything else becomes a PNG, which keeps transparency.
 * Whatever nativeImage can't read, or doesn't come out smaller, goes as it was.
 */
export function shrinkImage(dataUrl: string, max: number): string {
  const image = nativeImage.createFromDataURL(dataUrl);
  const { width, height } = image.getSize();
  const long = Math.max(width, height);
  if (image.isEmpty() || long <= max) return dataUrl;
  const small = image.resize({
    width: Math.round((width * max) / long),
    height: Math.round((height * max) / long),
    quality: "good",
  });
  const shrunk = dataUrl.startsWith("data:image/jpeg")
    ? `data:image/jpeg;base64,${small.toJPEG(82).toString("base64")}`
    : small.toDataURL();
  return shrunk.length < dataUrl.length ? shrunk : dataUrl;
}
