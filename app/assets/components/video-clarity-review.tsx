"use client";
import { useEffect, useState } from "react";
import { apiErrorStatus, getVideoClarityReview } from "../../../lib/api";
import type { ClarityReview } from "../lib/video-clarity-types";
import { clarityRange, parseClarityReview } from "../lib/video-clarity-presentation";
import styles from "./video-clarity.module.css";

const blur: Record<string, string> = { overall: "整体模糊", subject: "主体模糊", background: "背景模糊", mixed: "多处模糊", none: "未见明显模糊", uncertain: "模糊范围不确定" };
const artifacts: Record<string, string> = { mosaic: "马赛克", dark_color_blocks: "暗块/色块", ghosting: "重影/拖尾", flicker: "闪烁", identity_damage: "主体失真", text_damage: "文字破坏", other: "其它明显缺陷" };
const status: Record<string, string> = { not_reviewed: "尚无当前审查结果", queued: "等待审查", running: "正在按分镜审查", reviewed: "分镜抽样审查完成", insufficient: "证据不足", unavailable: "当前审查不可用" };

export default function VideoClarityReview({ assetId, token }: { assetId: number; token?: string }) {
  const [report, setReport] = useState<ClarityReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setReport(null); setError(null);
    getVideoClarityReview(token ?? null, assetId, abort.signal).then(value => {
      const parsed = parseClarityReview(value);
      if (!parsed || parsed.requested_asset_id !== assetId) throw new Error("clarity_report_invalid");
      if (!abort.signal.aborted) setReport(parsed);
    }).catch(reason => {
      if (!abort.signal.aborted) setError(apiErrorStatus(reason) === 409
        ? "当前视频尚未就绪或来源已变化，清晰度报告暂不可用。原片仍保留。"
        : "当前报告暂时无法读取。");
    });
    return () => abort.abort();
  }, [assetId, token, revision]);
  return <section className={styles.card} aria-label="视频清晰度审查">
    <h3>清晰度审查</h3>
    <p>{error ?? (report?.failure === "input_duration_unsupported"
      ? "首版画质审查最长3分钟。当前视频超出范围，未开始专项画质审查，原视频已保留。"
      : report ? status[report.status] ?? "当前报告不可用" : "正在读取当前报告")}</p>
    <p className={styles.muted}>按真实分镜抽样，未覆盖内容不能视为已通过。收费增强暂未开放。</p>
    {report?.observations.map((row, index) => <article key={`${row.scene_id}-${index}`}>
      <strong>{row.scene_id} · {row.observed_blur === "obvious" ? blur[row.blur_scope] ?? "存在明显模糊" : row.observed_blur === "none" ? "未见明显模糊" : "无法确定模糊程度"}</strong>
      <p>{row.obvious_artifacts.map(value => artifacts[value] ?? "其它缺陷").join("、") || "未报告明显伪影"}</p>
      <p>{row.evidence}</p>
      {report.shot_boundaries.filter(shot => shot.scene_id === row.scene_id).map(shot => <p key={shot.interval_id}>完整分镜：{clarityRange(shot.start_seconds, shot.end_seconds)}</p>)}
      {report.eligible_intervals.some(shot => shot.scene_id === row.scene_id) ? <p>可尝试增强此完整分镜；需另行确认，不保证改善。</p> : null}
      {row.coverage !== "complete" || row.boundary_verification !== "verified" ? <p>本镜覆盖或边界证据不足，不能据此确认合格。</p> : null}
      {row.uncertainty.length ? <p>不确定性：{row.uncertainty.join("；")}</p> : null}
      {row.actionability === "original_generation_fix" ? <p>应先修复原生成结果与已确认规格的差异。</p> : null}
    </article>)}
    <button type="button" onClick={() => setRevision(value => value + 1)}>刷新审查报告</button>
  </section>;
}
