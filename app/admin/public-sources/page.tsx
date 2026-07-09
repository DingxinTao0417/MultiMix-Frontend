"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { authLocalDevAdmin, isApiConfigured, type PublicSourceRead } from "../../../lib/api";
import { assetWorkspaceAdapter } from "../../assets/lib/asset-workspace-adapter";

type AdminSourceRow = PublicSourceRead & {
  draftOnly?: boolean;
  priority?: number;
  quotaUsed?: number;
  quotaLimit?: number;
  quotaLabel?: string;
};

type AdminState = {
  token: string | null;
  sources: PublicSourceRead[];
  loading: boolean;
  message: string | null;
};

const DEFAULT_FRONT_ONLY_SOURCES: AdminSourceRow[] = [
  {
    provider: "ui-example-pexels",
    name: "Pexels",
    enabled: true,
    media_types: ["image", "video"],
    license_policy: "可商用公开素材",
    health_status: "未测试",
    last_checked_at: null,
    draftOnly: true,
    priority: 1,
    quotaUsed: 890,
    quotaLimit: 1000
  },
  {
    provider: "ui-example-pixabay",
    name: "Pixabay",
    enabled: true,
    media_types: ["image", "video"],
    license_policy: "可商用公开素材",
    health_status: "未测试",
    last_checked_at: null,
    draftOnly: true,
    priority: 2,
    quotaUsed: 312,
    quotaLimit: 1000
  },
  {
    provider: "ui-example-unsplash",
    name: "Unsplash",
    enabled: false,
    media_types: ["image"],
    license_policy: "可商用公开素材",
    health_status: "未测试",
    last_checked_at: null,
    draftOnly: true,
    priority: 3,
    quotaUsed: 0,
    quotaLimit: 1000,
    quotaLabel: "已停用"
  },
  {
    provider: "ui-example-custom",
    name: "自建素材站",
    enabled: false,
    media_types: ["video"],
    license_policy: "自定义授权",
    health_status: "未配置",
    last_checked_at: null,
    draftOnly: true,
    priority: 4,
    quotaUsed: 0,
    quotaLimit: 1,
    quotaLabel: "未配置 API Key"
  }
];

function mediaTypesLabel(source: PublicSourceRead): string {
  const labels = source.media_types.map((item) => item === "image" ? "图片" : "视频");
  if (labels.length === 0) return "—";
  if (labels.includes("图片") && labels.includes("视频")) return "图片 + 视频";
  return labels[0] === "图片" ? "仅图片" : "视频";
}

function sourceInitials(source: PublicSourceRead): string {
  const name = source.name || source.provider;
  if (/^[\x00-\x7F]+$/.test(name)) return name.slice(0, 2);
  return name.slice(0, 1);
}

function adminSourceRow(source: PublicSourceRead, index: number): AdminSourceRow {
  return {
    ...source,
    priority: index + 1,
    quotaUsed: source.enabled ? Math.min(1000, 220 + index * 170) : 0,
    quotaLimit: 1000,
    quotaLabel: source.enabled ? undefined : "已停用"
  };
}

function quotaInfo(source: AdminSourceRow) {
  const used = Math.max(0, source.quotaUsed ?? 0);
  const limit = Math.max(1, source.quotaLimit ?? 1000);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const label = source.quotaLabel ?? `${used} / ${limit} 次`;
  return { percent, label };
}

function healthStatusLabel(source: AdminSourceRow): string {
  if (!source.enabled) return "已停用";
  const status = source.health_status || "未知";
  if (/ok|healthy|normal|success|正常/i.test(status)) return "正常";
  if (/fail|error|失败|异常/i.test(status)) return "异常";
  if (/未配置/.test(status)) return "未配置";
  return status === "unknown" || status === "未知" ? "未检查" : status;
}

export default function PublicSourcesAdminPage() {
  const [state, setState] = useState<AdminState>({ token: null, sources: [], loading: true, message: null });
  const [frontOnlyDraftSources, setFrontOnlyDraftSources] = useState<AdminSourceRow[]>(DEFAULT_FRONT_ONLY_SOURCES);

  const realSourceRows = state.sources.map(adminSourceRow);
  const customDraftRows = frontOnlyDraftSources.filter((source) => source.provider.startsWith("draft-local-"));
  const sourceRows = realSourceRows.length ? [...realSourceRows, ...customDraftRows] : frontOnlyDraftSources;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isApiConfigured) {
        setState({ token: null, sources: [], loading: false, message: "当前为前端草稿模式，修改仅保存为本页草稿。" });
        return;
      }
      try {
        const auth = await authLocalDevAdmin();
        if (!auth.access_token) throw new Error("管理员登录失败。");
        const sources = await assetWorkspaceAdapter.listAdminPublicSources(auth.access_token);
        if (!cancelled) setState({ token: auth.access_token, sources, loading: false, message: null });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "公开素材源读取失败。";
        if (!cancelled) setState({ token: null, sources: [], loading: false, message: `${detail} 已切换为前端草稿模式。` });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateDraftSource = (source: AdminSourceRow, enabled: boolean) => {
    setFrontOnlyDraftSources((current) => current.map((item) => (
      item.provider === source.provider ? { ...item, enabled, quotaLabel: enabled ? undefined : "已停用" } : item
    )));
  };

  const addDraftSource = () => {
    const count = frontOnlyDraftSources.filter((source) => source.provider.startsWith("draft-local-")).length + 1;
    const next: AdminSourceRow = {
      provider: `draft-local-${Date.now()}`,
      name: `新素材源 ${count}`,
      enabled: false,
      media_types: ["image", "video"],
      license_policy: "待配置授权",
      health_status: "未配置",
      last_checked_at: null,
      draftOnly: true,
      priority: sourceRows.length + 1,
      quotaUsed: 0,
      quotaLimit: 1,
      quotaLabel: "未配置 API Key"
    };
    setFrontOnlyDraftSources((current) => [...current, next]);
    setState((current) => ({ ...current, message: "已添加素材源草稿，仅保存为本页草稿。" }));
  };

  const updateSource = async (source: AdminSourceRow, enabled: boolean) => {
    if (source.draftOnly || !state.token) {
      updateDraftSource(source, enabled);
      setState((current) => ({
        ...current,
        message: `${source.name} 已${enabled ? "启用" : "停用"}，仅保存为本页草稿。`
      }));
      return;
    }
    if (!state.token) return;
    setState((current) => ({ ...current, message: null }));
    try {
      const updated = await assetWorkspaceAdapter.updateAdminPublicSource(state.token, source.provider, { enabled });
      setState((current) => ({
        ...current,
        sources: current.sources.map((item) => item.provider === updated.provider ? updated : item),
        message: `${updated.name} 已${updated.enabled ? "启用：将按顺序参与兜底" : "停用：不再提供兜底素材"}。`
      }));
    } catch (error) {
      setState((current) => ({ ...current, message: error instanceof Error ? error.message : "更新失败。" }));
    }
  };

  const checkHealth = async (source: AdminSourceRow) => {
    if (source.draftOnly || !state.token) {
      setState((current) => ({ ...current, message: `${source.name} 未发起真实连接测试，仅保存为本页草稿。` }));
      return;
    }
    if (!state.token) return;
    setState((current) => ({ ...current, message: null }));
    try {
      const updated = await assetWorkspaceAdapter.checkAdminPublicSourceHealth(state.token, source.provider);
      setState((current) => ({
        ...current,
        sources: current.sources.map((item) => item.provider === updated.provider ? updated : item),
        message: `${updated.name} 健康检查：${updated.health_status}`
      }));
    } catch (error) {
      setState((current) => ({ ...current, message: error instanceof Error ? error.message : "健康检查失败。" }));
    }
  };

  return (
    <main className="shadcn-prototype-admin-page">
      <header className="shadcn-prototype-admin-topbar">
        <span className="shadcn-prototype-admin-brand-mark" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 12V2.5L7 8l5-5.5V12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="shadcn-prototype-admin-crumb">管理 / <b>公开素材源</b></span>
        <span className="shadcn-prototype-admin-tag">管理员</span>
        <Link className="shadcn-prototype-admin-back" href="/">
          <ChevronLeft size={13} aria-hidden="true" />
          返回工作台
        </Link>
      </header>

      <div className="shadcn-prototype-admin-main">
        <div className="shadcn-prototype-admin-wrap">
          <div className="shadcn-prototype-admin-head">
            <div>
              <h1>公开素材源管理</h1>
              <p>配置分镜未命中商家素材时可用的兜底素材提供方</p>
            </div>
            <button type="button" className="shadcn-prototype-admin-add" onClick={addDraftSource}>
              <Plus size={13} aria-hidden="true" />
              添加素材源
            </button>
          </div>

          <div className="shadcn-prototype-admin-rule">
            <b>兜底规则</b>：公开素材只在分镜没有匹配到商家自有素材（no_asset_hit）后按优先级使用，永远不会抢在已保存素材前面；使用了兜底素材的分镜会在工作台明确标注。
          </div>

          {state.message ? <p className="shadcn-prototype-library-action-message" role="status">{state.message}</p> : null}
          {state.loading ? <p className="shadcn-prototype-admin-loading">加载中...</p> : null}

          {sourceRows.length ? (
            <div className="shadcn-prototype-admin-table">
              <div className="shadcn-prototype-admin-tr th">
                <span>素材源</span>
                <span>类型</span>
                <span>优先级</span>
                <span>许可证策略</span>
                <span>状态</span>
                <span>今日额度</span>
                <span>健康状态</span>
                <span className="ops">操作</span>
              </div>
              {sourceRows.map((source, index) => {
                const quota = quotaInfo(source);
                return (
                <div className={source.draftOnly ? "shadcn-prototype-admin-tr draft" : "shadcn-prototype-admin-tr"} key={source.provider}>
                  <span className="shadcn-prototype-admin-src">
                    <span className="ic" aria-hidden="true">{sourceInitials(source)}</span>
                    <span>
                      <b>{source.name}</b>
                      {source.draftOnly ? <em>仅保存为本页草稿</em> : null}
                    </span>
                  </span>
                  <span className="cell">{mediaTypesLabel(source)}</span>
                  <span className="cell">{source.priority ?? index + 1}</span>
                  <span className="cell">{source.license_policy || "—"}</span>
                  <label className="shadcn-prototype-admin-toggle">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={(event) => void updateSource(source, event.currentTarget.checked)}
                      aria-label={`${source.name} ${source.enabled ? "停用" : "启用"}`}
                    />
                    <i />
                  </label>
                  <span className="shadcn-prototype-admin-quota">
                    <span className="bar"><span style={{ width: `${quota.percent}%` }} /></span>
                    <span>{quota.label}</span>
                  </span>
                  <span className="cell">{healthStatusLabel(source)}</span>
                  <span className="ops">
                    <button type="button" className="op" onClick={() => void checkHealth(source)}>
                      测试连接
                    </button>
                    <button
                      type="button"
                      className="op"
                      onClick={() => {
                        setState((current) => ({ ...current, message: `${source.name} 配置面板暂为前端态，${source.draftOnly ? "仅保存为本页草稿。" : "后续接入持久化。"} ` }));
                      }}
                    >
                      编辑
                    </button>
                  </span>
                </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
