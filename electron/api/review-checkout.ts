import { app, dialog, shell } from "electron";
import { z } from "zod";
import { lineQuestionSchema } from "../../shared/questions";
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
import { launchCodex } from "../local";
import { readLocalFile, saveLocalFile } from "../local-files";
import { launchLineQuestion } from "../questions";
import { inspectFolder } from "../repository";
import {
  performGitAction,
  validateRepo,
  workingDiff,
  workingTree,
} from "../working-tree";
import type { ApiContext, Handlers } from "./context";

/** A reviewed repository's linked local checkout: its changes, files, and agents run in it. */
export function reviewCheckoutHandlers(ctx: ApiContext) {
  const {
    store,
    liveSyncs,
    requireClient,
    repoKey,
    linkedFolder,
    requireFolder,
  } = ctx;

  async function checkoutRoot(where: unknown) {
    const r = repoSchema.parse(where);
    return validateRepo(requireFolder(r), requireClient().account.server, r);
  }

  /** A file in the PR's checkout, which must be at the head the page shows. */
  async function localFile(args: unknown[]) {
    const r = refSchema.parse(args[0]);
    const dir = requireFolder(r);
    const head = shaSchema.parse(args[1]);
    const path = filePathSchema.parse(args[2]);
    if ((await requireClient().pull(r)).head.sha !== head)
      throw new Error(
        "This PR has new commits. Refresh it and check out the new head before editing.",
      );
    return { r, dir, head, path, server: requireClient().account.server };
  }

  return {
    workingTree: async (args) => workingTree(await checkoutRoot(args[0])),
    workingDiff: async (args) =>
      workingDiff(
        await checkoutRoot(args[0]),
        workingPathSchema.parse(args[1]),
        z.enum(["staged", "unstaged"]).parse(args[2]),
      ),
    gitAction: async (args) =>
      performGitAction(
        await checkoutRoot(args[0]),
        gitActionSchema.parse(args[1]),
        (file) => shell.trashItem(file),
      ),
    folder: (args) => {
      const r = repoSchema.parse(args[0]),
        dir = linkedFolder(r);
      return dir ? inspectFolder(dir, requireClient().account.server, r) : null;
    },
    linkFolder: async (args) => {
      const r = repoSchema.parse(args[0]);
      const result = await dialog.showOpenDialog(ctx.window.win!, {
        title: "Link local Git repository",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      const local = await inspectFolder(
        result.filePaths[0],
        requireClient().account.server,
        r,
      );
      if (!local.remoteMatches)
        throw new Error(
          "This folder’s Git remote does not match the Gitea project. Choose the correct repository.",
        );
      await liveSyncs.stopWhere((_, root) => root === linkedFolder(r));
      await store.update((s) => {
        s.folders[repoKey(r)] = local.path;
      });
      return local;
    },
    readLocalFile: async (args) => {
      const { r, dir, head, path, server } = await localFile(args);
      return readLocalFile(dir, server, r, head, path);
    },
    saveLocalFile: async (args) => {
      const { r, dir, head, path, server } = await localFile(args);
      return saveLocalFile(
        dir,
        server,
        r,
        head,
        path,
        digestSchema.parse(args[3]),
        textSchema.parse(args[4]),
      );
    },
    askAboutLines: async (args) => {
      const ref = refSchema.parse(args[0]),
        question = lineQuestionSchema.parse(args[1]);
      const dir = requireFolder(ref);
      const settings = store.aiSettings();
      await launchLineQuestion(
        requireClient(),
        dir,
        app.getPath("userData"),
        ref,
        question,
        settings.questions,
        settings.questionsProvider,
      );
    },
    launchCodex: async (args) => {
      const r = refSchema.parse(args[0]),
        dir = requireFolder(r);
      const head = shaSchema.parse(args[1]);
      const p = await requireClient().pull(r);
      if (p.head.sha !== head)
        throw new Error("This PR changed. Refresh before starting Codex.");
      await launchCodex(
        dir,
        app.getPath("userData"),
        r,
        head,
        filePathSchema.parse(args[2]),
        z.number().int().positive().parse(args[3]),
        sideSchema.parse(args[4]),
        bodySchema.parse(args[5]),
        requireClient().account.server,
      );
    },
  } satisfies Handlers;
}
