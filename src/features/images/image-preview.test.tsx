import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AnswerImage,
  imageQuery,
  useWorkingImages,
  type PreviewImage,
} from "./ImagePreview";

const image = (key: string, load: () => Promise<string>): PreviewImage => ({
  key,
  name: `${key}.png`,
  load,
});
const loaded = image("loaded", async () => "data:image/png;base64,");
const missing = image("missing", async () => {
  throw new Error("ENOENT");
});
const pending = image("pending", () => new Promise(() => {}));

function Keys({ keep }: { keep?: string }) {
  const images = useWorkingImages([loaded, missing, pending], keep);
  return <>{images.map((i) => i.key).join(",")}</>;
}

const render = async (keep?: string) => {
  const client = new QueryClient();
  await client.query(imageQuery(loaded)).catch(() => {});
  await client.query(imageQuery(missing)).catch(() => {});
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Keys keep={keep} />
    </QueryClientProvider>,
  );
};

it("drops images that failed to load and keeps those still loading", async () => {
  expect(await render()).toBe("loaded,pending");
});

it("keeps a failed image while the viewer has it open", async () => {
  expect(await render("missing")).toBe("loaded,missing,pending");
});

it("retries a transient read but gives up after two retries", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Turn not saved yet"))
    .mockResolvedValue("data:image/png;base64,");
  const client = new QueryClient();
  await expect(
    client.query({ ...imageQuery(image("late", load)), retryDelay: 0 }),
  ).resolves.toBe("data:image/png;base64,");
  expect(load).toHaveBeenCalledTimes(2);

  const fail = vi.fn().mockRejectedValue(new Error("Still unavailable"));
  await expect(
    client.query({ ...imageQuery(image("unavailable", fail)), retryDelay: 0 }),
  ).rejects.toThrow("Still unavailable");
  expect(fail).toHaveBeenCalledTimes(3);
  client.clear();
});

it("keeps a loaded image when a later read fails", async () => {
  const client = new QueryClient();
  await client.query(imageQuery(loaded));
  await client
    .query({
      ...imageQuery(loaded),
      staleTime: 0,
      retry: false,
      queryFn: async () => {
        throw new Error("Temporary read failure");
      },
    })
    .catch(() => {});
  expect(client.getQueryState(imageQuery(loaded).queryKey)?.status).toBe(
    "error",
  );
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Keys />
    </QueryClientProvider>,
  );
  expect(markup).toBe("loaded,missing,pending");
  client.clear();
});

it("offers retry instead of silently dropping an embedded image that fails to load", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryOnMount: false } },
  });
  await client.query({ ...imageQuery(missing), retry: false }).catch(() => {});
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AnswerImage image={missing} alt="Screenshot" onOpen={() => {}} />
    </QueryClientProvider>,
  );
  expect(markup).toContain("This image couldn&#x27;t load.");
  expect(markup).toContain("Retry image");
  client.clear();
});
