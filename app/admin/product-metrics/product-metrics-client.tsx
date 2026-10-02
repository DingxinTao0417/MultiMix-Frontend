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

function CostCoverage({ outcomes }: { outcomes: NonNullable<AdminProductMetrics["video_outcomes"]> }) {
  const amount = (value: number | null | undefined, symbol: string) => (
    value == null ? "未知" : `${symbol}${value.toFixed(6)}`
  );
  const count = (value: number | undefined) => value ?? "暂无覆盖数据";
  const cards = [
    ["有费用记录任务", count(outcomes.cost_recorded_tasks)],
    ["未记录费用任务", count(outcomes.cost_unrecorded_tasks)],
    ["已记录调用", count(outcomes.cost_recorded_calls)],
    ["金额未知调用", count(outcomes.cost_unknown_price_calls)],
    ["人民币已知估算小计", amount(outcomes.known_estimated_cost_cny_subtotal, "¥")],
    ["美元已知估算小计", amount(outcomes.known_estimated_cost_usd_subtotal, "$")],
    ["供应商账单分摊小计", amount(outcomes.supplier_allocated_cost_usd_subtotal, "$")],
  ] as const;
  return (
    <section aria-label="费用记录覆盖">
      <h3>费用记录覆盖</h3>
      <div className={styles.cards}>
        {cards.map(([label, value]) => (
          <article key={label} aria-label={label}><span>{label}</span><strong>{value}</strong></article>
        ))}
      </div>
      <p>已计价调用：{count(outcomes.cost_priced_calls)}；账单分摊覆盖调用：{count(outcomes.cost_allocated_calls)}。估算与分摊分别展示，不相加、不换算币种，也不等于整片实付成本。</p>
      <p>各阶段有记录任务：文本 {count(outcomes.cost_text_recorded_tasks)}、视觉理解 {count(outcomes.cost_visual_recorded_tasks)}、图片 {count(outcomes.cost_image_recorded_tasks)}、图生视频 {count(outcomes.cost_video_recorded_tasks)}、配音 {count(outcomes.cost_voice_recorded_tasks)}。有记录不代表费用已完整覆盖。</p>
      <p>归属不明调用：{count(outcomes.cost_ambiguous_calls)}；缺调用身份记录：{count(outcomes.cost_unidentified_records)}；目标冲突生成任务：{count(outcomes.cost_unbound_generation_jobs)}。缺失金额显示未知；预算预留不计支出。</p>
      <p>范围为当前时间窗启动的视频任务及可核对的制作记录，包含已记录的失败和重试费用。渲染、历史缺账、未关联图片、尚未形成工程的创作及共享素材摊销尚未完整覆盖。</p>
    </section>
  );
}

function VideoOutcomes({ outcomes }: { outcomes: AdminProductMetrics["video_outcomes"] }) {
  if (!outcomes) {
    return <section aria-label="视频结果指标"><h2>视频结果</h2><p>视频结果指标暂不可用</p></section>;
  }
  const cards = [
    ["已启动任务", outcomes.started_tasks],
    ["已有可播放结果", outcomes.first_playable_tasks],
    ["可播放结果率", percent(outcomes.first_playable_rate)],
    ["用户已接受", outcomes.accepted_tasks],
    ["首版已接受", outcomes.first_version_accepted_tasks],
    ["首版接受率", percent(outcomes.first_version_acceptance_rate)],
    ["可播放但未表态", outcomes.unreviewed_playable_tasks],
    ["用户自报已发布", outcomes.user_reported_published_tasks],
    ["两轮内采用", outcomes.accepted_within_two_user_edits_tasks ?? "尚未采集"],
    ["修改次数可核验任务", outcomes.user_edit_covered_tasks ?? "暂无覆盖数据"],
    ["修改次数未知任务", outcomes.user_edit_unknown_tasks ?? "暂无覆盖数据"],
    ["后台制作等待中位数", duration(outcomes.first_render_wait_seconds_median)],
    ["前台主动操作时间中位数", outcomes.user_active_seconds_median === null
      ? "尚未采集" : duration(outcomes.user_active_seconds_median)],
    ["已采用视频实付成本中位数", outcomes.accepted_cost_usd_median === null
      ? "暂无实付数据" : `$${outcomes.accepted_cost_usd_median.toFixed(2)}`],
    ["实付成本覆盖任务", outcomes.accepted_cost_covered_tasks],
    ["用户类型尚未区分的任务", outcomes.audience_unclassified_tasks],
    ["已观察工程交互时间中位数", outcomes.observed_video_interaction_seconds_median == null
      ? "暂无观测" : duration(outcomes.observed_video_interaction_seconds_median)],
    ["交互时间覆盖工程", outcomes.observed_video_interaction_projects ?? "暂无观测"],
    ["已观察编导交互时间中位数", outcomes.observed_director_interaction_seconds_median == null
      ? "暂无观测" : duration(outcomes.observed_director_interaction_seconds_median)],
    ["交互时间覆盖编导稿", outcomes.observed_director_interaction_scripts ?? "暂无观测"],
    ["已观察创作交互时间中位数", outcomes.observed_creation_interaction_seconds_median == null
      ? "暂无观测" : duration(outcomes.observed_creation_interaction_seconds_median)],
    ["创作交互覆盖任务", outcomes.observed_creation_interaction_tasks ?? "暂无观测"],
  ] as const;
  return (
    <section aria-label="视频结果指标">
      <h2>视频结果</h2>
      <p>可播放结果率和首版接受率以已启动任务为分母；下载不等于用户接受或发布。</p>
      <div className={styles.cards}>
        {cards.map(([label, value]) => (
          <article key={label} aria-label={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <p>排除管理员和已标记的测试用户。尚未区分的用户类型不代表真实商家验证；后台等待不等于用户主动操作时间，估算费用不等于实付。</p>
      <p>交互观测只覆盖成功上报的已保存编导稿和工程前台操作，同一任务重叠时间只计一次。不含首次出稿前输入、后台等待和未上报操作，可能少计；不等于完整创作投入。统计以已启动工程及其核验来源为范围，尚无工程的编导稿未覆盖。</p>
      <p>两轮内采用仅统计修改链完整的任务：首个可播放视频之后，最多两次成功的用户内容修改，并明确接受当前结果。内部重试和临时快照不计次数；历史或缺少记录的任务显示未知。首版接受只计已核验的零修改采用，采集不完整时可能低估。</p>
      <CostCoverage outcomes={outcomes} />
    </section>
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

        <VideoOutcomes outcomes={metrics.video_outcomes} />

        <footer>
          最近生成：{new Date(metrics.generated_at).toLocaleString("zh-CN", { hour12: false })}
        </footer>
      </div>
    </main>
  );
}
