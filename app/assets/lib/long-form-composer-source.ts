import type { ChatAttachmentFileKind, ChatAttachmentStatus } from "./asset-workspace-shared";
import type { AssetLongFormAction } from "./asset-workspace-types";
import {
  importLongFormSourceUrl,
  uploadLongFormSource,
  waitForLongFormSourceReady,
  type LongFormSourceReady,
} from "./long-form-client";

const LONG_FORM_VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
  "player.bilibili.com",
]);

export type LongFormComposerSourceInput =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string };

export type LongFormComposerAttachment = {
  assetId?: number;
  fileKind: ChatAttachmentFileKind;
  status: ChatAttachmentStatus;
};

export function supportedLongFormUrlFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (
      LONG_FORM_VIDEO_HOSTS.has(url.hostname.toLowerCase())
      || url.pathname.toLowerCase().endsWith(".mp4")
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export async function prepareLongFormComposerSource({
  token,
  input,
  signal,
  onProgress,
}: {
  token: string;
  input: LongFormComposerSourceInput;
  signal: AbortSignal;
  onProgress: (percent: number | null) => void;
}): Promise<LongFormSourceReady> {
  if (input.kind === "file") {
    return uploadLongFormSource(token, input.file, onProgress);
  }

  onProgress(null);
  const imported = await importLongFormSourceUrl(token, input.url);
  if (imported.status !== "completed") {
    await waitForLongFormSourceReady(token, imported.asset_id, signal);
  }
  return { id: imported.asset_id, title: "网络视频" };
}

export function resolveLongFormAnalyzeAction(
  attachments: readonly LongFormComposerAttachment[],
  instruction: string,
): AssetLongFormAction | undefined {
  const readyVideos = attachments.filter((attachment) => (
    attachment.fileKind === "video"
    && attachment.status === "ready"
    && typeof attachment.assetId === "number"
  ));
  const sourceAssetId = readyVideos.length === 1 ? readyVideos[0]?.assetId : undefined;
  if (typeof sourceAssetId !== "number" || !instruction.trim()) return undefined;
  return { kind: "analyze", sourceAssetId };
}
