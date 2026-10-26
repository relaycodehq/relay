import { describe, expect, it } from "vitest";
import { chosenHidden, sidebarChoiceAfter } from "./sidebar-choice";

describe("sidebar choice", () => {
  it("stays hidden in a thread with a side pane after hiding it beside the chat alone", () => {
    const choice = sidebarChoiceAfter(true, false);
    expect(chosenHidden(choice, true, false)).toBe(true);
  });

  it("stays hidden beside the chat alone after hiding it beside a pane", () => {
    const choice = sidebarChoiceAfter(true, true);
    expect(chosenHidden(choice, false, false)).toBe(true);
  });

  it("stays shown everywhere after showing it beside a pane", () => {
    const choice = sidebarChoiceAfter(false, true);
    expect(chosenHidden(choice, false, true)).toBe(false);
    expect(chosenHidden(choice, true, true)).toBe(false);
  });

  it("still makes room for a side pane after showing it beside the chat alone", () => {
    const choice = sidebarChoiceAfter(false, false);
    expect(chosenHidden(choice, true, true)).toBe(true);
    expect(chosenHidden(choice, true, false)).toBe(false);
  });
});
