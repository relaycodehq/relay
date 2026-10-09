import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** A photo ready to send: the desktop takes JPEG, PNG or WebP data URLs up to 1.1 MB, three at most. */
export interface Attachment {
  uri: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
  /** A queued message's screenshot taken back: unique where `uri` is its whole data URL. */
  id?: string;
  /** Its `[Image #n]` token in the text; see shared/image-refs. Photos picked here have none. */
  n?: number;
}

export const maxImages = 3;
const maxChars = 1_100_000;
/** Tried in turn until the photo fits: long side in pixels, JPEG quality. */
const steps: [number, number][] = [
  [1600, 0.8],
  [1280, 0.7],
  [1024, 0.6],
  [800, 0.5],
];

export async function pickImages(
  from: "library" | "camera",
  limit: number,
): Promise<Attachment[]> {
  if (limit < 1) return [];
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsMultipleSelection: from === "library" && limit > 1,
    selectionLimit: limit,
    quality: 1,
  };
  if (from === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("Relay needs the camera to take a photo.");
  }
  const result =
    from === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  return Promise.all(result.assets.slice(0, limit).map(prepare));
}

/**
 * The clipboard's image, if it holds one. React Native's text field can't take
 * an image from the paste menu or the keyboard, so the composer offers this
 * instead. Android shows nothing for asking whether there is one; it only
 * tells the user when the image itself is read.
 */
export async function pasteImage(): Promise<Attachment | undefined> {
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (!image) return undefined;
  // The manipulator, like Android's image loader, won't open a data: URI.
  const file = new File(Paths.cache, `pasted-${Date.now()}.png`);
  file.write(image.data.slice(image.data.indexOf(",") + 1), { encoding: "base64" });
  try {
    return await prepare({ uri: file.uri, ...image.size, fileName: "pasted" });
  } finally {
    file.delete();
  }
}

async function prepare(
  asset: Pick<ImagePicker.ImagePickerAsset, "uri" | "width" | "height" | "fileName">,
): Promise<Attachment> {
  const long = Math.max(asset.width, asset.height);
  for (const [side, compress] of steps) {
    const context = ImageManipulator.manipulate(asset.uri);
    if (long > side)
      context.resize(
        asset.width >= asset.height ? { width: side } : { height: side },
      );
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress,
      base64: true,
    });
    const dataUrl = `data:image/jpeg;base64,${saved.base64}`;
    if (dataUrl.length <= maxChars)
      return {
        uri: saved.uri,
        name: `${(asset.fileName ?? "photo").replace(/\.[^.]+$/, "").slice(0, 100)}.jpg`,
        mimeType: "image/jpeg",
        dataUrl,
      };
  }
  throw new Error("That photo is too large to send.");
}
