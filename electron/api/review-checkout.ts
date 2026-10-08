import { app, dialog, shell } from "electron";
import { z } from "zod";
import { lineQuestionSchema } from "../../shared/questions";
import type { PullRef, Repo } from "../../shared/types";
import {
  bodySchema,
  digestSchema,
  filePathSchema,
  refSchema,
  repoSchema,
  shaSchema,
  sideSchema,
  textSchema,
} from "../../shared/validation";
import { gitActionSchema, workingPathSchema } from "../../shared/working-tree";
import { launchCodex } from "../pull-requests/local";
import { readLocalFile, saveLocalFile } from "../pull-requests/local-files";
import { launchLineQuestion } from "../pull-requests/questions";
import { inspectFolder } from "../git/repository";
import {
  performGitAction,
  validateRepo,
  workingDiff,
  workingTree,
} from "../git/working-tree";
import { takes, type ApiContext, type Handlers } from "./context";

/** A reviewed repository's linked local checkout: its changes, files, and agents run in it. */
export function reviewCheckoutHandlers(ctx: ApiContext) {
  const {
    store,
    requireServer,
    clientFor,
    repoKey,
    linkedFolder,
    requireFolder,
  } = ctx;

  const checkoutRoot = (r: Repo) =>
    validateRepo(requireFolder(r), requireServer(r), r);

  /** The PR's checkout, which must be at the head the page shows. */
  async function checkoutAt(r: PullRef, head: string) {
    const dir = requireFolder(r);
    if ((await (await clientFor(r)).pull(r)).head.sha !== head)
      throw new Error(
        "This PR has new commits. Refresh it and check out the new head before editing.",
      );
    return dir;
  }
  const localFileArgs = [refSchema, shaSchema, filePathSchema] as const;

  return {
    workingTree: takes([repoSchema], async (r) =>
      workingTree(await checkoutRoot(r)),
    ),
    workingDiff: takes(
      [repoSchema, workingPathSchema, z.enum(["staged", "unstaged"])],
      async (r, path, area) => workingDiff(await checkoutRoot(r), path, area),
    ),
    gitAction: takes([repoSchema, gitActionSchema], async (r, action) =>
      performGitAction(await checkoutRoot(r), action, (file) =>
        shell.trashItem(file),
      ),
    ),
    folder: takes([repoSchema], (r) => {
      const dir = linkedFolder(r);
      return dir ? inspectFolder(dir, requireServer(r), r) : null;
    }),
    linkFolder: takes([repoSchema], async (r) => {
      const result = await dialog.showOpenDialog(ctx.window.win!, {
        title: "Link local Git repository",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      const local = await inspectFolder(
        result.filePaths[0],
        requireServer(r),
        r,
      );
      if (!local.remoteMatches)
        throw new Error(
          "This folder’s Git remote does not match this repository. Choose the correct repository.",
        );
      await store.update((s) => {
        s.folders[repoKey(r)] = local.path;
      });
      return local;
    }),
    readLocalFile: takes(localFileArgs, async (r, head, path) => {
      const dir = await checkoutAt(r, head);
      return readLocalFile(dir, requireServer(r), r, head, path);
    }),
    saveLocalFile: takes(
      [...localFileArgs, digestSchema, textSchema],
      async (r, head, path, version, contents) => {
        const dir = await checkoutAt(r, head);
        return saveLocalFile(
          dir,
          requireServer(r),
          r,
          head,
          path,
          version,
          contents,
        );
      },
    ),
    askAboutLines: takes(
      [refSchema, lineQuestionSchema],
      async (ref, question) => {
        const dir = requireFolder(ref);
        const settings = store.aiSettings();
        await launchLineQuestion(
          await clientFor(ref),
          dir,
          app.getPath("userData"),
          ref,
          question,
          settings.questions,
          settings.questionsProvider,
        );
      },
    ),
    launchCodex: takes(
      [
        refSchema,
        shaSchema,
        filePathSchema,
        z.number().int().positive(),
        sideSchema,
        bodySchema,
      ],
      async (r, head, path, line, side, comment) => {
        const dir = requireFolder(r);
        const p = await (await clientFor(r)).pull(r);
        if (p.head.sha !== head)
          throw new Error("This PR changed. Refresh before starting Codex.");
        await launchCodex(
          dir,
          app.getPath("userData"),
          r,
          head,
          path,
          line,
          side,
          comment,
          requireServer(r),
        );
      },
    ),
  } satisfies Handlers;
}
