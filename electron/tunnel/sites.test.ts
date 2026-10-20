import { expect, it } from "vitest";
import { listSites } from "./sites";

it("lists the ports this computer's projects listen on, not those of a project on another computer", async () => {
  const sites = await listSites(
    {
      projects: async () => [
        { id: "here", name: "web" },
        { id: "there", name: "api", computer: { id: "box" } },
      ],
      dispatch: async (_method, [id]) => [
        { title: "dev", command: "vite", ports: id === "here" ? [5173] : [3000] },
      ],
    },
    [],
  );
  expect(sites.map((s) => [s.project, s.port])).toEqual([["web", 5173]]);
});
