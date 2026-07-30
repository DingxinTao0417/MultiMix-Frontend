export const CHAT_IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
export const CHAT_SOURCE_UPLOAD_ACCEPT = ".pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm";

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|mkv)$/i;
const SOURCE_EXTENSION_PATTERN = /\.(pdf|txt|md|markdown|html|htm|xlsx|xlsm)$/i;

export type ChatAttachmentPartition = {
  acceptedFiles: File[];
  rejectedVideoCount: number;
  rejectedUnsupportedCount: number;
};

export function partitionChatAttachmentFiles(
  files: FileList | File[],
): ChatAttachmentPartition {
  const partition: ChatAttachmentPartition = {
    acceptedFiles: [],
    rejectedVideoCount: 0,
    rejectedUnsupportedCount: 0,
  };

  for (const file of Array.from(files)) {
    if (file.type.startsWith("video/") || VIDEO_EXTENSION_PATTERN.test(file.name)) {
      partition.rejectedVideoCount += 1;
    } else if (file.type.startsWith("image/") || SOURCE_EXTENSION_PATTERN.test(file.name)) {
      partition.acceptedFiles.push(file);
    } else {
      partition.rejectedUnsupportedCount += 1;
    }
  }

  return partition;
}

export function chatAttachmentRejectionMessage(
  partition: ChatAttachmentPartition,
): string | null {
  const messages: string[] = [];
  if (partition.rejectedVideoCount > 0) {
    messages.push("对话暂不支持视频附件，请先上传到视频素材库。");
  }
  if (partition.rejectedUnsupportedCount > 0) {
    messages.push("暂不支持该附件格式。");
  }
  return messages.length ? messages.join(" ") : null;
}
