import { API_CONNECTION_ERROR } from "../../../lib/api";

export type RuntimeWriteConnectionState = "checking" | "available" | "unavailable";
export type RuntimeWriteAvailability = RuntimeWriteConnectionState | "unconfigured";

export type RuntimeWriteCapabilities = {
  availability: RuntimeWriteAvailability;
  canUpload: boolean;
  canGenerate: boolean;
  canPersist: boolean;
  reason: string | null;
  recovery: "retry" | "restart" | null;
};

type RuntimeWriteCapabilityInput = {
  backendConfigured: boolean;
  hasToken: boolean;
  connectionState: RuntimeWriteConnectionState;
};

const AVAILABLE_CAPABILITIES: RuntimeWriteCapabilities = {
  availability: "available",
  canUpload: true,
  canGenerate: true,
  canPersist: true,
  reason: null,
  recovery: null,
};

export const DEFAULT_RUNTIME_WRITE_CAPABILITIES = AVAILABLE_CAPABILITIES;

export function resolveRuntimeWriteCapabilities({
  backendConfigured,
  hasToken,
  connectionState,
}: RuntimeWriteCapabilityInput): RuntimeWriteCapabilities {
  if (!backendConfigured) {
    return {
      availability: "unconfigured",
      canUpload: false,
      canGenerate: false,
      canPersist: false,
      reason: "未连接后端。请配置 NEXT_PUBLIC_API_BASE_URL 后重启前端，创作、上传和保存暂不可用。",
      recovery: "restart",
    };
  }
  if (!hasToken || connectionState === "checking") {
    return {
      availability: "checking",
      canUpload: false,
      canGenerate: false,
      canPersist: false,
      reason: "正在连接后端，创作、上传和保存暂不可用。",
      recovery: null,
    };
  }
  if (connectionState === "unavailable") {
    return {
      availability: "unavailable",
      canUpload: false,
      canGenerate: false,
      canPersist: false,
      reason: "后端暂时不可用，创作、上传和保存暂不可用。请重新连接后再试。",
      recovery: "retry",
    };
  }
  return AVAILABLE_CAPABILITIES;
}

export function isRuntimeConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message === API_CONNECTION_ERROR;
}
