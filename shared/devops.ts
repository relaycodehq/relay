import { z } from "zod";
import { agentMentionPattern } from "./agents";

export const devopsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Organization name or its dev.azure.com / visualstudio.com URL. */
    organization: z.string().trim().max(300),
    /** Azure DevOps project; empty searches every project in the organization. */
    project: z.string().trim().max(200),
    auth: z.enum(["pat", "azure-cli"]),
    /** Relay project ids that never show work item cards. */
    hiddenProjects: z.array(z.string().max(200)).max(500),
    filter: z
      .object({
        enabled: z.boolean(),
        /** An OpenRouter System One model, such as Jev. */
        model: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .regex(/^[a-zA-Z0-9~][a-zA-Z0-9._:/~-]*$/, "Enter a valid model ID."),
        /** Yes-probability a work item needs to count as part of a project. */
        threshold: z.number().min(0.05).max(0.95),
        /** Relay project id → hints the filter should look for. */
        keywords: z.record(z.string().max(80), z.string().trim().max(1000)),
      })
      .strict(),
  })
  .strict();
export type DevOpsSettings = z.infer<typeof devopsSettingsSchema>;

export const defaultDevOpsSettings: DevOpsSettings = {
  enabled: false,
  organization: "",
  project: "",
  auth: "pat",
  hiddenProjects: [],
  filter: { enabled: false, model: "jev-latest", threshold: 0.5, keywords: {} },
};

/** `undefined` keeps the saved secret, `null` forgets it. */
export const devopsSecretsSchema = z
  .object({
    pat: z.string().trim().min(1).max(1024).nullable().optional(),
    openRouterKey: z.string().trim().min(1).max(1024).nullable().optional(),
  })
  .strict();
export type DevOpsSecrets = z.infer<typeof devopsSecretsSchema>;

export interface DevOpsStatus {
  settings: DevOpsSettings;
  hasPat: boolean;
  hasOpenRouterKey: boolean;
  /** False when secrets are kept for this session only. */
  persistent: boolean;
}

export interface WorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  areaPath: string;
  project: string;
  tags: string[];
  changed: string;
  /** Plain-text description, trimmed. */
  description: string;
  url: string;
}

export interface WorkItemsResult {
  items: WorkItem[];
  /** Filter yes-probability per work item id; null when the filter is off. */
  relevance: Record<number, number> | null;
  threshold: number;
  filterError?: string;
}

export interface DevOpsApi {
  devopsStatus(): Promise<DevOpsStatus>;
  saveDevOpsSettings(
    settings: DevOpsSettings,
    secrets: DevOpsSecrets,
  ): Promise<DevOpsStatus>;
  devopsWorkItems(
    projectId: string | null,
    refresh?: boolean,
  ): Promise<WorkItemsResult>;
}

/** Accepts `org`, `https://dev.azure.com/org` or `https://org.visualstudio.com`. */
export function organizationUrl(value: string) {
  const text = value.trim().replace(/\/+$/, "");
  if (!text) throw new Error("Enter your Azure DevOps organization.");
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(text))
    return `https://dev.azure.com/${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Enter an organization name or its Azure DevOps URL.");
  }
  if (url.protocol !== "https:")
    throw new Error("Azure DevOps URLs must use https.");
  if (url.hostname === "dev.azure.com") {
    const org = url.pathname.split("/").filter(Boolean)[0];
    if (!org) throw new Error("The URL is missing the organization name.");
    return `https://dev.azure.com/${org}`;
  }
  if (url.hostname.endsWith(".visualstudio.com")) return url.origin;
  // Azure DevOps Server keeps the collection in the path.
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/**
 * The message an attached work item sends: the item, a `~` separator, then
 * whatever the user wrote. A leading agent mention stays in front.
 */
export function workItemMessage(item: WorkItem, body: string) {
  const mention = agentMentionPattern.exec(body.trim());
  const text = mention ? body.trim().slice(mention[0].length) : body.trim();
  const details = [
    `State: ${item.state}`,
    item.areaPath && `Area: ${item.areaPath}`,
    item.tags.length > 0 && `Tags: ${item.tags.join(", ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const message = [
    "User has selected this work item:",
    `${item.type || "Work item"} #${item.id}: ${item.title}`,
    details,
    item.url,
    ...(item.description ? ["", item.description.slice(0, 4000)] : []),
    ...(text ? ["~", text] : []),
  ].join("\n");
  return mention ? `${mention[0].trim()} ${message}` : message;
}
