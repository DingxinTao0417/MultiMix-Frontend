"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import { authLocalDevAdmin, isApiConfigured, type PublicSourceRead } from "../../../lib/api";
import { assetWorkspaceAdapter } from "../../assets/lib/asset-workspace-adapter";

type AdminState = {
  token: string | null;
  sources: PublicSourceRead[];
  loading: boolean;
  message: string | null;
};

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
        message: `${updated.name} 已${updated.enabled ? "启用" : "停用"}。`
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
      <header>
        <span><ShieldCheck size={18} aria-hidden="true" /> 管理员</span>
        <h1>公开素材源</h1>
        <p>第一版只维护内置公开源启停、媒体类型、许可证策略和健康状态。API key 和视觉模型配置不在这里展示。</p>
      </header>
      {state.message ? <p className="shadcn-prototype-library-action-message" role="status">{state.message}</p> : null}
      {state.loading ? <p>加载中...</p> : null}
      <section className="shadcn-prototype-admin-source-list">
        {state.sources.map((source) => (
          <article key={source.provider}>
            <div>
              <strong>{source.name}</strong>
              <span>{source.provider}</span>
            </div>
            <dl>
              <div><dt>状态</dt><dd>{source.enabled ? "已启用" : "已停用"}</dd></div>
              <div><dt>媒体</dt><dd>{source.media_types.map((item) => item === "image" ? "图片" : "视频").join("、")}</dd></div>
              <div><dt>许可证策略</dt><dd>{source.license_policy}</dd></div>
              <div><dt>健康状态</dt><dd>{source.health_status}</dd></div>
            </dl>
            <div className="shadcn-prototype-admin-source-actions">
              <button type="button" onClick={() => void updateSource(source, !source.enabled)}>
                {source.enabled ? "停用" : "启用"}
              </button>
              <button type="button" onClick={() => void checkHealth(source)}>
                <Activity size={14} aria-hidden="true" />
                健康检查
              </button>
              <button type="button" onClick={() => window.location.reload()}>
                <RefreshCw size={14} aria-hidden="true" />
                刷新
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
