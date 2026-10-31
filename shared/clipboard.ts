export interface ClipboardApi {
  readClipboard(): Promise<string>;
  /** `html`, when given, is what apps that take HTML paste instead. */
  writeClipboard(text: string, html?: string): Promise<void>;
  writeClipboardImage(dataUrl: string): Promise<void>;
}
