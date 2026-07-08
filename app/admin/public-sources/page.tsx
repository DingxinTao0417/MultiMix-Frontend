"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { authLocalDevAdmin, isApiConfigured, type PublicSourceRead } from "../../../lib/api";
import { assetWorkspaceAdapter } from "../../assets/lib/asset-workspace-adapter";

type AdminState = {
  token: string | null;
  sources: PublicSourceRead[];
  loading: boolean;
  message: string | null;
};

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

export default function PublicSourcesAdminPage() {
  const [state, setState] = useState<AdminState>({ token: null, sources: [], loading: true, message: null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isApiConfigured) {
        setState({ token: null, sources: [], loading: false, message: "未配置后端 API，无法维护公开素材源。" });
        return;
      }
      try {
        const auth = await authLocalDevAdmin();
        if (!auth.access_token) throw new Error("管理员登录失败。");
        const sources = await assetWorkspaceAdapter.listAdminPublicSources(auth.access_token);
        if (!cancelled) setState({ token: auth.access_token, sources, loading: false, message: null });
      } catch (error) {
        if (!cancelled) setState({ token: null, sources: [], loading: false, message: error instanceof Error ? error.message : "公开素材源读取失败。" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSource = async (source: PublicSourceRead, enabled: boolean) => {
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

  const checkHealth = async (source: PublicSourceRead) => {
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
          </div>

          <div className="shadcn-prototype-admin-rule">
            <b>兜底规则</b>：公开素材只在分镜没有匹配到商家自有素材（no_asset_hit）后使用，永远不会抢在已保存素材前面；使用了兜底素材的分镜会在工作台明确标注。
          </div>

          {state.message ? <p className="shadcn-prototype-library-action-message" role="status">{state.message}</p> : null}
          {state.loading ? <p className="shadcn-prototype-admin-loading">加载中...</p> : null}

          {state.sources.length ? (
            <div className="shadcn-prototype-admin-table">
              <div className="shadcn-prototype-admin-tr th">
                <span>素材源</span>
                <span>类型</span>
                <span>许可证策略</span>
                <span>状态</span>
                <span>健康状态</span>
                <span className="ops">操作</span>
              </div>
              {state.sources.map((source) => (
                <div className="shadcn-prototype-admin-tr" key={source.provider}>
                  <span className="shadcn-prototype-admin-src">
                    <span className="ic" aria-hidden="true">{sourceInitials(source)}</span>
                    {source.name}
                  </span>
                  <span className="cell">{mediaTypesLabel(source)}</span>
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
                  <span className="cell">
                    {source.enabled ? source.health_status || "未知" : "已停用"}
                  </span>
                  <span className="ops">
                    <button type="button" className="op" onClick={() => void checkHealth(source)}>
                      测试连接
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
