import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chmodSync, cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundles } from "./electron-bundles.mjs";

for (const { options } of bundles) await build(options);

// Live checks fall back to TypeScript 5.9 for projects whose compiler has no
// language service API. It has its own install so its tsc bin stays out of
// the root node_modules, and loads its lib.*.d.ts from beside typescript.js.
const fallbackRoot = "packaging/checks-typescript",
  fallback = join(fallbackRoot, "node_modules/typescript"),
  fallbackOut = "dist-electron/typescript-5";
if (!existsSync(fallback))
  execFileSync(
    "npm",
    [
      "ci",
      "--prefix",
      fallbackRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
rmSync(fallbackOut, { recursive: true, force: true });
for (const name of ["package.json", "LICENSE.txt", "ThirdPartyNoticeText.txt"])
  cpSync(join(fallback, name), join(fallbackOut, name));
cpSync(join(fallback, "lib"), join(fallbackOut, "lib"), {
  filter: (path) =>
    path === join(fallback, "lib") ||
    /[\\/](typescript\.js|lib\.[^\\/]*\.d\.ts)$/.test(path),
  recursive: true,
});

// node-pty loads its native binaries from beside its own lib/, so it ships as
// plain files next to main.cjs (unpacked from the asar), not in the bundle.
const pty = "node_modules/node-pty",
  ptyOut = "dist-electron/node-pty";
rmSync(ptyOut, { recursive: true, force: true });
cpSync(join(pty, "package.json"), join(ptyOut, "package.json"));
cpSync(join(pty, "lib"), join(ptyOut, "lib"), {
  recursive: true,
  filter: (path) => !/\.(test\.js|map)$/.test(path),
});
// A source build (Linux) lands in build/Release; macOS and Windows use prebuilds.
const native = existsSync(join(pty, "build/Release/pty.node"))
  ? "build/Release"
  : `prebuilds/${process.platform}-${process.arch}`;
cpSync(join(pty, native), join(ptyOut, native), {
  recursive: true,
  filter: (path) =>
    !/\.(pdb|o|d|mk)$|\/obj(\.target)?(\/|$)|\/\.deps(\/|$)/.test(path),
});
// node-pty 1.1.0 publishes spawn-helper without its executable bit, and
// every shell then fails with "posix_spawnp failed".
const helper = join(ptyOut, native, "spawn-helper");
if (existsSync(helper)) chmodSync(helper, 0o755);

// sherpa-onnx-node finds its native addon in a sibling folder named for the
// platform, whose libraries load from beside the addon; both ship as plain
// files, and only this platform's addon comes along.
const sherpaOut = "dist-electron/sherpa",
  sherpaNative = `sherpa-onnx-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
rmSync(sherpaOut, { recursive: true, force: true });
cpSync("node_modules/sherpa-onnx-node", join(sherpaOut, "sherpa-onnx-node"), {
  recursive: true,
  filter: (path) => !/\.(md|d\.ts)$/.test(path),
});
if (existsSync(join("node_modules", sherpaNative)))
  cpSync(join("node_modules", sherpaNative), join(sherpaOut, sherpaNative), {
    recursive: true,
    filter: (path) => !/\.(md|lib|h)$/.test(path),
  });

// onnxruntime-node, which runs read aloud's voice engines, names its native
// addon by a path built at runtime. Its bundle loads the addon from a bin/
// folder beside it, and both ship as plain files unpacked from the asar, with
// only this platform's binaries. The Linux CUDA providers its postinstall can
// fetch, and the macOS library's second name, aren't needed.
const ortOut = "dist-electron/onnxruntime",
  ortNative = `bin/napi-v6/${process.platform}/${process.arch}`;
rmSync(ortOut, { recursive: true, force: true });
await build({
  entryPoints: ["node_modules/onnxruntime-node/dist/index.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: join(ortOut, "dist/index.cjs"),
  plugins: [
    {
      name: "onnxruntime-binding",
      setup(build) {
        build.onLoad(
          { filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ },
          ({ path }) => {
            const source = readFileSync(path, "utf8");
            const contents = source.replace(
              /require\(`\.\.\/bin\/([^`]*onnxruntime_binding\.node)`\)/,
              "require(require('node:path').join(__dirname, `../bin/$1`))",
            );
            if (contents === source)
              throw new Error("onnxruntime-node's binding.js changed shape.");
            return { contents, loader: "js" };
          },
        );
      },
    },
  ],
});
cpSync(
  join("node_modules/onnxruntime-node", ortNative),
  join(ortOut, ortNative),
  {
    recursive: true,
    filter: (path) =>
      !/libonnxruntime_providers_|libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(
        path,
      ),
  },
);
