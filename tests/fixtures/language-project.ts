import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
export const reviewPath = "src/hooks/useReview.ts";
export const reviewCode =
  "import { greet } from '../greeting';\n\nexport const message: string = 42;\nexport const first = greet('Ada');\nexport const second = greet('Lin');\n";
export const greetingCode =
  "/** Formats a friendly greeting. */\nexport function greet(name: string) {\n  return `Hello, ${name}`;\n}\n";
export async function languageProject(server: string, angular = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-language-")));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const toolchain = resolve("tests/fixtures/language-toolchain/node_modules");
  await realpath(toolchain).catch(() => {
    throw new Error("Install language test tooling first: npm run test:setup");
  });
  await symlink(toolchain, join(root, "node_modules"), "dir");
  await mkdir(join(root, "src/hooks"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "node_modules\n");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      dependencies: angular ? { "@angular/core": "21.2.20" } : {},
      devDependencies: { typescript: "5.9.3" },
    }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        experimentalDecorators: true,
        skipLibCheck: true,
        noEmit: true,
      },
      angularCompilerOptions: { strictTemplates: true },
      include: ["src/**/*.ts"],
    }),
  );
  await writeFile(join(root, reviewPath), reviewCode);
  await writeFile(join(root, "src/greeting.ts"), greetingCode);
  if (angular) {
    await writeFile(
      join(root, "src/card.ts"),
      "import { Component } from '@angular/core';\n@Component({selector: 'test-card', templateUrl: './card.html'})\nexport class Card { title = 'Review'; }\n",
    );
    await writeFile(
      join(root, "src/card.html"),
      "<h1>{{ title }}</h1>\n<p>{{ missing }}</p>\n",
    );
  }
  git("init", "--quiet");
  git("config", "user.name", "Relay test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", server + "/Web/web-store.git");
  git("add", ".");
  git("commit", "--quiet", "-m", "Language service fixture");
  return { root, head: git("rev-parse", "HEAD"), git };
}
