import { readBounded } from "../../shared/http";
import { networkError } from "../util/network-errors";
import type { FetchRequest } from "./host";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

type Send = (headers: Record<string, string>) => Promise<Response>;

/** Shared request lifetime and decoding; each host owns auth, retries and errors. */
export class HostRequests {
  private controllers = new Set<AbortController>();
  constructor(private fetchRequest: FetchRequest) {}

  dispose() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  async request<T>(
    url: string,
    options: RequestOptions & { text?: boolean; tooLarge: string },
    response: (send: Send) => Promise<Response>,
  ): Promise<{ data: T; headers: Headers }> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    try {
      const result = await response((headers) =>
        this.fetchRequest(url, {
          method: options.method ?? "GET",
          headers: {
            ...headers,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          redirect: "error",
          credentials: "omit",
          signal,
        }).catch((error: unknown) => {
          throw networkError(error, url);
        }),
      );
      const body = await readBounded(
        result,
        options.limit ?? 8 * 1024 * 1024,
        options.tooLarge,
      );
      return {
        data: (options.text ? body : body ? JSON.parse(body) : null) as T,
        headers: result.headers,
      };
    } catch (error) {
      // Fetch errors and body-read failures should say when the caller cancelled.
      if (signal.aborted)
        throw new Error("Request cancelled or timed out. Please retry.");
      throw error;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
}

/** The optional JSON detail returned with a host's HTTP error. */
export async function responseMessage(response: Response) {
  const detail = await response.text().catch(() => "");
  try {
    return (JSON.parse(detail) as { message?: string }).message;
  } catch {
    return undefined;
  }
}
