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

  async function checkout(
    args: unknown[],
    method: "workingTree" | "workingDiff" | "gitAction",
  ) {
    const r = repoSchema.parse(args[0]);
    const root = await validateRepo(
      requireFolder(r),
      requireClient().account.server,
      r,
    );
    if (method === "workingTree") return workingTree(root);
    if (method === "workingDiff")
      return workingDiff(
        root,
        workingPathSchema.parse(args[1]),
        z.enum(["staged", "unstaged"]).parse(args[2]),
      );
    return performGitAction(root, gitActionSchema.parse(args[1]), (file) =>
      shell.trashItem(file),
    );
  }

  async function localFile(
    args: unknown[],
    method: "readLocalFile" | "saveLocalFile",
  ) {
    const r = refSchema.parse(args[0]);
    const dir = requireFolder(r);
    const head = shaSchema.parse(args[1]);
    const path = filePathSchema.parse(args[2]);
    if ((await requireClient().pull(r)).head.sha !== head)
      throw new Error(
        "This PR has new commits. Refresh it and check out the new head before editing.",
      );
    const server = requireClient().account.server;
    if (method === "readLocalFile")
      return readLocalFile(dir, server, r, head, path);
    return saveLocalFile(
      dir,
      server,
      r,
      head,
      path,
      digestSchema.parse(args[3]),
      textSchema.parse(args[4]),
    );
  }

  return {
    workingTree: checkout,
    workingDiff: checkout,
    gitAction: checkout,
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
    readLocalFile: localFile,
    saveLocalFile: localFile,
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
