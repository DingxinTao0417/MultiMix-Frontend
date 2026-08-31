"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { parseStoredLocalUser } from "@/app/lib/local-auth-session";
import {
  apiErrorStatus,
  getAdminProductMetrics,
  type AdminProductMetrics,
} from "@/lib/api";

import styles from "./product-metrics.module.css";


const LOCAL_USER_KEY = "multimix_local_user";
const WINDOWS = [7, 30, 90] as const;

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "error" }
  | { kind: "ready"; metrics: AdminProductMetrics };


function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}


function duration(value: number | null): string {
  if (value === null) return "暂无数据";
  if (value < 60) return `${Math.round(value)} 秒`;
  if (value < 3600) return `${Math.round(value / 60)} 分钟`;
  return `${(value / 3600).toFixed(1)} 小时`;
}


function AccessState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className={styles.shell}>
      <section className={styles.accessCard}>
        <div className={styles.brand}>MultiMix</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        <Link href="/app/assets">返回登录页</Link>
      </section>
    </main>
  );
}


export default function ProductMetricsClient() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const storedUser = parseStoredLocalUser(window.localStorage.getItem(LOCAL_USER_KEY));
    if (!storedUser?.token) {
      setState({ kind: "signed-out" });
      return () => {
        cancelled = true;
      };
    }

    setState({ kind: "loading" });
    void getAdminProductMetrics(storedUser.token, windowDays)
      .then((metrics) => {
        if (!cancelled) setState({ kind: "ready", metrics });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status = apiErrorStatus(error);
        if (status === 401) {
          window.localStorage.removeItem(LOCAL_USER_KEY);
          setState({ kind: "expired" });
        } else if (status === 403) {
          setState({ kind: "denied" });
        } else {
          setState({ kind: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  if (state.kind === "signed-out") {
    return <AccessState title="请先登录" detail="登录管理员账号后再查看产品指标。" />;
  }
  if (state.kind === "expired") {
    return <AccessState title="登录已失效，请重新登录" detail="当前会话已过期，指标数据未显示。" />;
  }
  if (state.kind === "denied") {
    return <AccessState title="无权访问此页面" detail="该页面仅向管理员开放。" />;
  }
  if (state.kind === "error") {
    return <AccessState title="指标暂时不可用" detail="请稍后刷新页面重试。" />;
  }
  if (state.kind === "loading") {
    return (
      <main className={styles.shell}>
        <div className={styles.loading} role="status">正在读取管理员指标…</div>
      </main>
    );
  }

  const { metrics } = state;
  const cards = [
    ["激活率", percent(metrics.rates.activation_rate)],
    ["获得可编辑视频", percent(metrics.rates.editable_video_rate)],
    ["修改率", percent(metrics.rates.modified_video_rate)],
    ["导出率", percent(metrics.rates.exported_video_rate)],
    ["用户素材分镜占比", percent(metrics.rates.saved_asset_scene_rate)],
    ["查看来源依据", percent(metrics.rates.source_evidence_open_rate)],
    ["选择推荐任务", percent(metrics.rates.recommendation_select_rate)],
  ];

  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>MultiMix 管理后台</div>
            <h1>产品指标</h1>
            <p>业务结果来自权威业务表；界面行为仅使用脱敏事件补充。</p>
          </div>
          <Link href="/app/assets">返回工作台</Link>
        </header>

        <nav className={styles.windowPicker} aria-label="统计时间范围">
          {WINDOWS.map((days) => (
            <button
              className={days === windowDays ? styles.activeWindow : undefined}
              key={days}
              onClick={() => setWindowDays(days)}
              type="button"
            >
              最近 {days} 天
            </button>
          ))}
        </nav>

        <section className={styles.funnel} aria-label="产品激活漏斗">
          {metrics.funnel.map((step, index) => (
            <article key={step.key}>
              <span>{step.label}</span>
              <strong>{step.users}</strong>
              {index > 0 ? (
                <small>
                  上一步转化 {percent(step.users / Math.max(metrics.funnel[index - 1].users, 1))}
                </small>
              ) : <small>最近 {metrics.window_days} 天注册的非管理员用户 cohort</small>}
            </article>
          ))}
        </section>

        <section className={styles.cards} aria-label="产品关键指标">
          {cards.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        <section className={styles.durationPanel}>
          <div>
            <span>首个可编辑视频耗时中位数</span>
            <strong>{duration(metrics.durations.time_to_first_editable_video_seconds_median)}</strong>
          </div>
          <div>
            <span>首个可编辑视频耗时 P75</span>
            <strong>{duration(metrics.durations.time_to_first_editable_video_seconds_p75)}</strong>
          </div>
        </section>

        <footer>
          最近生成：{new Date(metrics.generated_at).toLocaleString("zh-CN", { hour12: false })}
        </footer>
      </div>
    </main>
  );
}
