import { expect, it } from "vitest";
import { gitError } from "./git";

it("keeps porcelain push rejection reasons and redacts remote credentials", () => {
  const error = Object.assign(new Error("Command failed"), {
    stdout:
      "To https://token@example.invalid/repo.git\n" +
      "!\tHEAD:refs/heads/main\t[rejected] (fetch first)\nDone\n",
    stderr:
      "error: failed to push some refs to 'https://token@example.invalid/repo.git'\n",
  });
  const message = gitError(error).message;
  expect(message).toContain("[rejected] (fetch first)");
  expect(message).toContain("https://[redacted]@example.invalid/repo.git");
  expect(message).not.toContain("token");
  expect(message).not.toContain("Done");
});

it("doesn't expose unrelated command stdout in errors", () => {
  const error = Object.assign(new Error("Command failed"), {
    stdout: "partial file contents\n",
    stderr: "fatal: unable to read file\n",
  });
  expect(gitError(error).message).toBe("fatal: unable to read file");
});

it("drops Git's terminal advice from errors", () => {
  const error = Object.assign(new Error("Command failed"), {
    stderr:
      "hint: Diverging branches can't be fast-forwarded, you need to either:\n" +
      "hint:\n" +
      "hint: \tgit merge --no-ff\n" +
      "fatal: Not possible to fast-forward, aborting.\n",
  });
  expect(gitError(error).message).toBe(
    "fatal: Not possible to fast-forward, aborting.",
  );
});
