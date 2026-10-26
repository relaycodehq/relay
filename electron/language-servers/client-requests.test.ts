import { describe, expect, it } from "vitest";
import { answerServerRequest } from "./client-requests";
import { servers } from "./registry";

describe("answerServerRequest", () => {
  const folder = { uri: "file:///p", name: "p" };

  it("gives a server its settings by section, and null for its own defaults", () => {
    const items = [{ section: "typescript" }, { section: "typescript.inlayHints.parameterNames" }, { section: "vtsls" }, { section: "" }];
    const answer = answerServerRequest("workspace/configuration", { items }, folder, servers.vtsls.settings) as unknown[];
    expect(answer[0]).toMatchObject({ inlayHints: { variableTypes: { enabled: true } } });
    expect(answer[1]).toEqual({ enabled: "literals", suppressWhenArgumentMatchesName: true });
    expect(answer[2]).toBeNull();
    // vtsls asks for everything at once, with an empty section.
    expect(answer[3]).toBe(servers.vtsls.settings);
  });

  it("leaves a server without settings on its defaults", () => {
    expect(answerServerRequest("workspace/configuration", { items: [{ section: "python" }] }, folder)).toEqual([null]);
  });
});
