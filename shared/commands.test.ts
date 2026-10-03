import { describe, it, expect } from "vitest";
import {
  argumentTrigger,
  commandTrigger,
  relayCommand,
} from "./commands";

describe("relay commands", () => {
  it("parses bare commands and arguments where a command takes them", () => {
    expect(relayCommand("/openpr")).toEqual({ name: "openpr", args: "" });
    expect(relayCommand(" /Effort high ")).toEqual({
      name: "effort",
      args: "high",
    });
    expect(relayCommand("/compact keep the API decisions")).toEqual({
      name: "compact",
      args: "keep the API decisions",
    });
  });
  it("rejects unknown commands and arguments to commands without any", () => {
    expect(relayCommand("/status")).toBeNull();
    expect(relayCommand("/files src")).toBeNull();
    expect(relayCommand("please /effort high")).toBeNull();
  });
  it("offers values only while the first argument is being typed", () => {
    expect(argumentTrigger("/effort hi")).toEqual({
      name: "effort",
      query: "hi",
      start: 0,
      inline: false,
    });
    expect(argumentTrigger("/effort ")).toMatchObject({
      name: "effort",
      query: "",
    });
    expect(argumentTrigger("/effort high now")).toBeNull();
    expect(argumentTrigger("/effort")).toBeNull();
    expect(commandTrigger("/eff")).toMatchObject({
      prefix: "/",
      query: "eff",
      inline: false,
    });
  });
  it("finds commands typed in the middle of a message", () => {
    expect(commandTrigger("fix the bug /eff")).toMatchObject({
      prefix: "/",
      query: "eff",
      start: 12,
      end: 16,
      inline: true,
    });
    expect(argumentTrigger("fix the bug /effort x and", 21)).toEqual({
      name: "effort",
      query: "x",
      start: 12,
      inline: true,
    });
    expect(commandTrigger("look in src/eff")).toBeNull();
    expect(commandTrigger("use $exp")).toMatchObject({
      prefix: "$",
      inline: false,
    });
  });
});
