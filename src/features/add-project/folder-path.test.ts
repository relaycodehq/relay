import { expect, it } from "vitest";
import { folderLabel, fromHomeFolder, parentFolder } from "./folder-path";

it("uses the chosen computer's home without confusing a similarly named folder", () => {
  expect(folderLabel("/home/sam/work", "/home/sam")).toBe("~/work");
  expect(folderLabel("/home/sammy/work", "/home/sam")).toBe("/home/sammy/work");
  expect(folderLabel("C:\\Users\\sam\\work", "C:\\Users\\sam")).toBe("~/work");
  expect(folderLabel("D:\\work", "C:\\Users\\sam")).toBe("D:/work");
});
it("keeps filesystem and home roots intact while browsing upward", () => {
  expect(parentFolder("~/work/app")).toBe("~/work");
  expect(parentFolder("~/work")).toBe("~");
  expect(parentFolder("~")).toBe("~");
  expect(parentFolder("/")).toBe("/");
  expect(parentFolder("/work")).toBe("/");
  expect(parentFolder("C:\\work")).toBe("C:/");
  expect(parentFolder("C:/")).toBe("C:/");
});
it("treats a Windows share as a root and browses up from home once it's known", () => {
  expect(parentFolder("\\\\server\\share")).toBe("\\\\server\\share");
  expect(parentFolder("\\\\server\\share\\work")).toBe("//server/share");
  expect(parentFolder(fromHomeFolder("~", "/home/sam"))).toBe("/home");
  expect(fromHomeFolder("~/work", "C:\\Users\\sam\\")).toBe("C:\\Users\\sam/work");
  expect(fromHomeFolder("~work", "/home/sam")).toBe("~work");
  expect(fromHomeFolder("~/work")).toBe("~/work");
});
