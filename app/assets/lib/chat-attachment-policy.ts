export const CHAT_IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
export const CHAT_SOURCE_UPLOAD_ACCEPT = ".pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm";
export const CHAT_VIDEO_UPLOAD_ACCEPT = ".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|mkv)$/i;
const SOURCE_EXTENSION_PATTERN = /\.(pdf|txt|md|markdown|html|htm|xlsx|xlsm)$/i;
const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
]);

export type ChatAttachmentPartition = {
  acceptedFiles: File[];
  rejectedUnsupportedCount: number;
};

export function partitionChatAttachmentFiles(
  files: FileList | File[],
): ChatAttachmentPartition {
  const partition: ChatAttachmentPartition = {
    acceptedFiles: [],
    rejectedUnsupportedCount: 0,
  };

  for (const file of Array.from(files)) {
    if (
      file.type.startsWith("image/")
      || SUPPORTED_VIDEO_MIME_TYPES.has(file.type.toLowerCase())
      || VIDEO_EXTENSION_PATTERN.test(file.name)
      || SOURCE_EXTENSION_PATTERN.test(file.name)
    ) {
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
  if (partition.rejectedUnsupportedCount > 0) {
    messages.push("暂不支持该附件格式。");
  }
  return messages.length ? messages.join(" ") : null;
}
