"use client";
import { useEffect, useState } from "react";
import { getVideoClarityCandidates } from "../../../lib/api";
import type { ClarityCandidate, ClarityResult } from "../lib/video-clarity-types";
import { parseClarityCandidates, CLARITY_RISK_COPY, CLARITY_RESEARCH_RISK_COPY, clarityCostLabel, clarityMoney, clarityQualityLabel, clarityRange } from "../lib/video-clarity-presentation";
import VideoClarityComparison from "./video-clarity-comparison";
import styles from "./video-clarity.module.css";

export default function ClarityProcessingNotice({ result, token, onPrepareAdoption }: {
  result: ClarityResult; token?: string; onPrepareAdoption?: (instruction: string) => void;
}) {
  const [candidates, setCandidates] = useState<ClarityCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const candidateKey = result.version === "video-clarity-result:v1" ? result.intervals.filter(row => row.qualified && row.candidate_id).map(row => row.candidate_id).sort().join(",") : "";
  const assetId = result.asset_id, jobId = result.job_id;
  useEffect(() => {
    setCandidates([]); setSelected([]); setError(false);
    if (!candidateKey) return;
    const abort = new AbortController();
    getVideoClarityCandidates(token ?? null, assetId, jobId, abort.signal).then(value => {
      const parsed = parseClarityCandidates(value, assetId, jobId);
      if (!parsed) throw new Error("Invalid candidate projection");
      if (!abort.signal.aborted) setCandidates(parsed.filter(row => row.review_status === "qualified" && row.adopted === false
        && row.comparison?.preview_independently_reviewed === false && candidateKey.split(",").includes(row.candidate_id)));
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [candidateKey, assetId, jobId, token, revision]);
  if (result.version === "video-clarity-adoption-result:v1") return <section className={styles.card} aria-label="画质采用状态">
    <h3>{result.status === "completed" ? "采用处理完成" : result.status === "blocked" || result.status === "failed" ? "采用未完成" : "正在准备采用结果"}</h3>
    <p>当前显示：{({ adopted: "增强使用版", original: "原版", other: "其它版本", pending: "尚未采用" })[result.current_selection]}</p>
    <p>原片保留，可通过历史版本恢复。采用不重复执行增强。</p>
  </section>;
  return <section className={styles.card} aria-label="画质处理状态">
    <h3>{result.status === "completed" ? "增强处理结束" : result.status === "blocked" ? "增强处理暂停，待核对" : result.status === "canceled" ? "增强已取消" : result.status === "failed" ? "增强处理失败" : "增强处理中"}</h3>
    {result.funding_purpose === "research" && result.needs_reconciliation
      && (result.processing_cost.unknown_executions > 0 || (result.research_model_cost?.unknown_executions ?? 0) > 0)
      && result.intervals.some(row => row.review) ? <p>复检结果已保存，研发费用待核账</p> : null}
    <p>{clarityQualityLabel(result.quality_status)} · 尚未采用</p>
    <p>{result.funding_purpose === "research" ? CLARITY_RESEARCH_RISK_COPY : CLARITY_RISK_COPY}</p>
    <p>{result.funding_purpose === "research" ? "项目研发支出：" : "已发生处理费："}{clarityCostLabel(result.processing_cost)}</p>
    {result.funding_purpose === "research" ? <p>模型研发支出：{result.research_model_cost ? clarityCostLabel(result.research_model_cost) : "待核对"}</p> : null}
    <p>{result.funding_purpose === "research" ? "本次不向测试用户收款" : <>收款：{result.payment.status === "receipts_available" && result.payment.settled_minor !== null ? `有结算凭证 ${clarityMoney(result.processing_cost.currency, result.payment.settled_minor)}` : "未核验收款，不能视为已支付"}</>}</p>
    <p>确认至结果可查看：{Math.ceil(result.delivery.elapsed_seconds)} 秒 · {result.delivery.target_met === true ? "本次在10分钟目标内" : result.delivery.target_met === false ? "本次超过10分钟目标" : "本次时效待核对"}</p>
    {result.delivery.elapsed_seconds > 600 && result.delivery.result_ready_at === null ? <p>已超过10分钟目标。需要继续处理或缩小范围时，请在对话中明确选择；缩小范围须重新报价确认。</p> : null}
    <table><thead><tr><th>完整分镜</th><th>复检与执行</th></tr></thead><tbody>{result.intervals.map(row => <tr key={row.interval_id}>
      <td>{row.scene_id}<br />{clarityRange(row.start_seconds, row.end_seconds)}</td>
      <td>{row.qualified ? "复检通过，尚未采用" : row.status === "unexecuted" ? "未执行" : row.status === "quality_failed" ? "复检未通过，保留原版" : row.status === "insufficient" ? "复检证据不足，保留原版" : "尚无合格候选"}
        {row.status === "unexecuted" && row.processing_fee_minor === 0 ? " · 处理费0" : ""}</td>
    </tr>)}</tbody></table>
    {error ? <p role="alert">候选暂时无法读取，当前作品未改变。</p> : null}
    {candidates.map(candidate => <div key={candidate.candidate_id}>
      <VideoClarityComparison candidate={candidate} />
      <label><input type="checkbox" checked={selected.includes(candidate.candidate_id)} onChange={e => setSelected(current => e.target.checked ? [...current, candidate.candidate_id] : current.filter(id => id !== candidate.candidate_id))} />选择 {candidate.scene_id} 的合格完整分镜</label>
    </div>)}
    {result.intervals.some(row => row.qualified) ? <button type="button" onClick={() => setRevision(value => value + 1)}>刷新候选</button> : null}
    {onPrepareAdoption && candidates.length ? <button type="button" disabled={!selected.length} onClick={() => {
      const picked = candidates.filter(row => selected.includes(row.candidate_id));
      if (picked.length) onPrepareAdoption(`请准备采用这些已复检合格的画质候选：${picked.map(row => `${row.scene_id}，${clarityRange(row.start_seconds, row.end_seconds)}`).join("；")}。请先展示采用确认，不修改其它分镜。`);
    }}>准备采用选中完整分镜</button> : null}
  </section>;
}
