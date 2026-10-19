import { expect, it } from "vitest";
import { fromTyped, suggestions } from "./add-targets";

it("reads a pairing link, a WSL distribution and an ssh host from what's typed", () => {
  expect(fromTyped(" relay-remote://pair?x=1 ", [])).toMatchObject({
    kind: "link",
    link: "relay-remote://pair?x=1",
  });
  expect(fromTyped("ubuntu", ["Ubuntu"])).toMatchObject({
    route: { kind: "wsl", distro: "Ubuntu" },
  });
  expect(fromTyped("ssh lubo@box", ["Ubuntu"])).toMatchObject({
    route: { kind: "ssh", host: "lubo@box" },
  });
  expect(fromTyped("   ", [])).toBeUndefined();
});

it("turns away what ssh would read as options", () => {
  expect(fromTyped("ssh -p 2222 box", [])).toHaveProperty("error");
  expect(fromTyped("-oProxyCommand=x", [])).toHaveProperty("error");
});

it("offers WSL first and leaves out what's paired already", () => {
  const { offered, hidden } = suggestions(
    ["Ubuntu"],
    [
      { host: "thinkcenter", hostName: "10.0.0.41", user: "lubo" },
      { host: "nas" },
    ],
    [{ route: { kind: "ssh", host: "nas" } }, {}],
  );
  expect(offered.map((t) => [t.name, t.detail])).toEqual([
    ["Ubuntu", "WSL on this computer"],
    ["thinkcenter", "lubo@10.0.0.41"],
  ]);
  expect(hidden).toBe(1);
});
