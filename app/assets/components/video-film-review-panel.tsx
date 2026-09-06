"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./video-film-review-panel.module.css";
import {
  getFilmReviews, requestFilmReviewRepair, startFilmReview,
  type FilmReviewFinding, type FilmReviewJob, type FilmReviewReport, type FilmReviewState,
} from "../../../lib/video-project-client";

export type FilmRevisionAction = "material" | "voice" | "timeline";
const POLL_MS = 2500;

export default function VideoFilmReviewPanel({ token, assetId, revisionKey, disabled = false,
  onLocate, onRevise, onEditScript }: {
  token: string;
  assetId: string | number;
  revisionKey: string;
  disabled?: boolean;
  onLocate: (issue: FilmReviewFinding) => void;
  onRevise: (issue: FilmReviewFinding, action: FilmRevisionAction) => void;
  onEditScript?: () => void;
}) {
  const [state, setState] = useState<FilmReviewState | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repairChoice, setRepairChoice] = useState<string | null>(null);
  const scope = `${assetId}:${revisionKey}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(null);
    setBusy(false);
    setError("");
    setRepairChoice(null);
    async function load() {
      try {
        const next = await getFilmReviews({ token, projectAssetId: assetId, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!next || !Array.isArray(next.reviews)) throw new Error("Invalid review response");
        setState(next);
        if (next.reviews.some((job) => ["queued", "running"].includes(job.status))) {
          timer = setTimeout(() => void load(), POLL_MS);
        }
      } catch {
        if (!controller.signal.aborted) setError("审阅记录暂时无法读取，请重试。");
      }
    }
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [assetId, token, revisionKey, reload]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      await startFilmReview({ token, projectAssetId: assetId });
      if (currentScope.current === scope) setReload((value) => value + 1);
    } catch (cause) {
      if (currentScope.current === scope) setError(cause instanceof Error ? cause.message : "审阅暂未完成。");
    } finally { if (currentScope.current === scope) setBusy(false); }
  }

  async function revise(job: FilmReviewJob, issue: FilmReviewFinding, action: FilmRevisionAction) {
    setBusy(true);
    try {
      await requestFilmReviewRepair({ token, projectAssetId: assetId, reviewId: job.id, issueId: issue.id });
      if (currentScope.current !== scope) return;
      setRepairChoice(null);
      onRevise(issue, action);
      setReload((value) => value + 1);
    } catch (cause) {
      if (currentScope.current === scope) setError(cause instanceof Error ? cause.message : "请刷新报告后重试。");
    } finally { if (currentScope.current === scope) setBusy(false); }
  }

  function finding(issue: FilmReviewFinding, job?: FilmReviewJob) {
    const current = !disabled && (job ? job.is_current : state?.script_review?.is_current !== false);
    return <li key={issue.id} className="mt-3">
      <strong>{issue.reason}</strong>
      <p>{issue.suggestion}</p>
      {job ? <p>{issue.start_seconds.toFixed(1)}–{issue.end_seconds.toFixed(1)} 秒</p> : null}
      {job?.report?.evidence?.some((item) => issue.evidence_ids.includes(item.id) && item.display_text) ? (
        <details><summary>查看观察依据</summary>
          {job.report.evidence.filter((item) => issue.evidence_ids.includes(item.id) && item.display_text)
            .map((item) => <p key={item.id}>{item.kind === "visual" ? "画面" : item.kind === "speech" ? "复转写" : "音频"}：{item.display_text}</p>)}
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2 mt-2">
        {job ? <button type="button" disabled={!current} onClick={() => onLocate(issue)}>定位问题</button> : null}
        {job ? <button type="button" disabled={!current || busy}
          onClick={() => setRepairChoice(repairChoice === issue.id ? null : issue.id)}>查看修订选项</button>
          : onEditScript ? <button type="button" disabled={!current} onClick={onEditScript}>编辑编导稿</button> : null}
      </div>
      {job?.requested_repairs.includes(issue.id) ? <p>已发起修订，等待新版本复验。</p> : null}
      {job && repairChoice === issue.id ? <div className="mt-2">
        <p>选择修改方式，在编辑界面确认应用；之后重新导出并审阅。</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {([['material', '更换画面'], ['voice', '修改口播'], ['timeline', '打开剪辑']] as const).map(([action, label]) =>
            <button key={action} type="button" disabled={busy || !current}
              onClick={() => void revise(job, issue, action)}>{label}</button>)}
        </div>
      </div> : null}
    </li>;
  }

  function reportContent(report: FilmReviewReport, job?: FilmReviewJob) {
    return <>
      <p className="mt-2">{report.summary}</p>
      {report.mode === "film" ? <p className="text-sm mt-1">
        {report.coverage.visual === "sampled" ? "画面抽样已审阅" : "画面观察未完成"}；
        {report.coverage.speech === "transcribed" ? "已复转写成片" : "复转写未完成"}；
        {report.coverage.audio === "decode_and_boundaries" ? "已测量音频剪口" : "音频剪口未检查"}。
      </p> : <p className="text-sm">文稿审阅，不代表成片效果已验证。</p>}
      {report.notes?.map((note) => <p className="text-sm" key={note}>{note}</p>)}
      <ul>{report.findings.map((issue) => finding(issue, job))}</ul>
      {report.follow_up.map((item) => <div key={item.issue_id} className="mt-3">
        <p>{item.status === "resolved" ? "本版复验已解决" : item.status === "open" ? "本版复验仍有问题" : "尚未确认修复"}：{item.issue.reason}</p>
        {item.status !== "resolved" && job ? <ul>{finding({ ...item.issue, id: item.issue_id }, job)}</ul> : null}
      </div>)}
    </>;
  }

  const pending = state?.reviews.some((job) => job.is_current && ["queued", "running"].includes(job.status));
  const latest = state?.reviews[0];
  const alreadyReviewed = latest?.is_current && latest.status === "completed"
    && latest.report && latest.report.status !== "unavailable";
  return <section className={styles.panel} aria-label="编导与成片审阅">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>编导与成片审阅</strong>
      <button type="button" disabled={busy || pending || disabled || !!alreadyReviewed || !state?.can_review}
        onClick={() => void start()}>{pending || busy ? "正在审阅…" : alreadyReviewed ? "当前成片已审阅" : latest ? "重新审阅当前成片" : "审阅当前成片"}</button>
    </div>
    <p className="text-sm mt-1">审阅建议不影响导出。修改后需重新导出、复验，才能确认问题已解决。</p>
    {disabled ? <p>请先保存修改并导出当前版本。</p> : state?.unavailable_reason ? <p>{state.unavailable_reason}</p> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>重试读取</button></p> : null}
    {state?.audio_direction && Object.values(state.audio_direction).some((item) => ["unsupported", "unverified"].includes(item.status)) ?
      <p>部分镜头的声音强调尚未确认执行，不能仅凭编导意图判断听感。</p> : null}
    {state?.script_review ? <details className="mt-2"><summary>全片文稿审阅{state.script_review.is_current === false ? "（已过期）" : ""}</summary>
      {reportContent(state.script_review)}</details> : null}
    {latest ? <div className="mt-2">
      {!latest.is_current || disabled ? <p role="status">报告已过期，不能代表当前版本。</p> : null}
      {latest.error ? <p role="alert">{latest.error}</p> : null}
      {latest.report ? reportContent(latest.report, latest) : null}
    </div> : null}
    {(state?.reviews.length ?? 0) > 1 ? <details className="mt-3"><summary>历史审阅记录</summary>
      {state?.reviews.slice(1).map((job) => <details key={job.id} className="mt-2">
        <summary>{job.created_at ? new Date(job.created_at).toLocaleString() : "历史版本"}</summary>
        {job.report ? reportContent(job.report, { ...job, is_current: false }) : <p>{job.error || "尚无报告"}</p>}
      </details>)}
    </details> : null}
  </section>;
}
