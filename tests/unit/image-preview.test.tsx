import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  imageQuery,
  useWorkingImages,
  type PreviewImage,
} from "../../src/components/ImagePreview";

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
  await client.prefetchQuery(imageQuery(loaded));
  await client.prefetchQuery(imageQuery(missing));
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
