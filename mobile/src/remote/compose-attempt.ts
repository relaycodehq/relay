import type { RemoteSettings } from "../../../shared/remote";

export interface ComposeDraft<Image> {
  /** The destination, including a new thread's workspace. */
  target: string;
  body: string;
  settings: RemoteSettings;
  images: Image[];
}

export interface ComposeAttempt<Image> extends ComposeDraft<Image> {
  id: string;
  delivery?: "queue" | "steer";
  sendAt?: number;
}

export function sameDraft<Image>(a: ComposeDraft<Image>, b: ComposeDraft<Image>): boolean {
  return a.target === b.target && a.body === b.body && a.images === b.images &&
    JSON.stringify(a.settings) === JSON.stringify(b.settings);
}

/** An unchanged failed draft retries its original delivery and id, even after an ambiguous reply. */
export function composeAttempt<Image>(
  draft: ComposeDraft<Image>,
  delivery: Pick<ComposeAttempt<Image>, "delivery" | "sendAt">,
  failed: ComposeAttempt<Image> | undefined,
  createId: () => string,
): ComposeAttempt<Image> {
  return failed && sameDraft(draft, failed)
    ? failed
    : { ...draft, ...delivery, id: createId() };
}
