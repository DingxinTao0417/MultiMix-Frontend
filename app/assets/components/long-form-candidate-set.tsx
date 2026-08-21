"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import VideoPreviewPlayer from "./video-preview-player";
import {
  type LongFormAnalysis,
  type LongFormCandidate,
} from "../lib/long-form-client";
import styles from "./long-form-candidate-set.module.css";

export { longFormAnalysisFromMetadata } from "../lib/long-form-client";

function timeLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function ratioClassName(ratio: LongFormCandidate["recommended_ratio"]): string {
  if (ratio === "9:16") return "ratio-portrait";
  if (ratio === "1:1") return "ratio-square";
  return "ratio-landscape";
}

export default function LongFormCandidateSet({
  analysisAssetId,
  analysis,
  sourcePlaybackUrl,
  chapterCount,
}: {
  analysisAssetId: number;
  analysis: LongFormAnalysis;
  sourcePlaybackUrl?: string;
  chapterCount?: number;
}) {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const candidatesById = useMemo(
    () => new Map(analysis.candidates.map((candidate) => [candidate.id, candidate])),
    [analysis.candidates],
  );
  const topCandidates = analysis.top_candidate_ids
    .map((id) => candidatesById.get(id))
    .filter((item): item is LongFormCandidate => Boolean(item?.grounded))
    .slice(0, 5);
  const [previewCandidateId, setPreviewCandidateId] = useState<string | null>(topCandidates[0]?.id ?? null);
  const previewCandidate = previewCandidateId ? candidatesById.get(previewCandidateId) : undefined;

  useEffect(() => {
    const player = playerRef.current;
    if (player && previewCandidate) player.currentTime = previewCandidate.source_start_seconds;
  }, [previewCandidate]);

  return (
    <section className={styles.root} aria-label="长视频拆条候选">
      <header className={styles.header}>
        <div>
          <span>内容地图</span>
          <strong>{chapterCount ?? analysis.chapters.length} 个章节</strong>
        </div>
        <div>
          <span>默认推荐</span>
          <strong>{topCandidates.length} 条优先候选</strong>
        </div>
      </header>

      {analysis.chapters.length ? (
        <ol className={styles.chapters} aria-label="章节地图">
          {analysis.chapters.map((chapter) => (
            <li key={chapter.id}>
              <time>{timeLabel(chapter.start_seconds)}–{timeLabel(chapter.end_seconds)}</time>
              <strong>{chapter.title}</strong>
              <span>{chapter.summary}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {sourcePlaybackUrl && previewCandidate ? (
        <div className={styles.player}>
          <VideoPreviewPlayer
            ref={playerRef}
            src={sourcePlaybackUrl}
            label={`原片预览：${previewCandidate.title}`}
            ratioClassName={ratioClassName(previewCandidate.recommended_ratio)}
            initialTime={previewCandidate.source_start_seconds}
            onTimeUpdate={(time) => {
              if (time >= previewCandidate.source_end_seconds) {
                playerRef.current?.pause();
              }
            }}
          />
        </div>
      ) : null}

      <div className={styles.candidates}>
        <article className={styles.preserveCard}>
          <div className={styles.rank}>默认方式</div>
          <div className={styles.cardTitle}>
            <h3>完整保留原意</h3>
          </div>
          <p>按原片章节和原有顺序保留完整表达，不删除口癖、空白或停顿。</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              aria-label="完整保留原意"
              onClick={() => window.dispatchEvent(new CustomEvent("multimix:long-form-action", {
                detail: { kind: "preserve", analysisAssetId },
              }))}
            >
              完整保留原意
            </button>
          </div>
        </article>
        {topCandidates.map((candidate, index) => (
          <article key={candidate.id} className={styles.card}>
            <div className={styles.rank}>Top {index + 1}</div>
            <div className={styles.cardTitle}>
              <h3>{candidate.title}</h3>
              {candidate.visual_completeness === "incomplete" ? <span>画面信息不完整</span> : null}
            </div>
            <p>{candidate.why_publish}</p>
            <blockquote>“{candidate.core_quote}”</blockquote>
            <dl>
              <div><dt>原片</dt><dd>{timeLabel(candidate.source_start_seconds)}–{timeLabel(candidate.source_end_seconds)}</dd></div>
              <div><dt>成片</dt><dd>约 {Math.round(candidate.target_seconds)} 秒</dd></div>
              <div><dt>比例</dt><dd>{candidate.recommended_ratio === "source" ? "保留原比例" : candidate.recommended_ratio}</dd></div>
            </dl>
            <div className={styles.actions}>
              {sourcePlaybackUrl ? (
                <button type="button" onClick={() => setPreviewCandidateId(candidate.id)}>预览原片</button>
              ) : null}
              <button
                type="button"
                className={styles.primary}
                aria-label={`把“${candidate.title}”提炼成短片（默认精简）`}
                onClick={() => window.dispatchEvent(new CustomEvent("multimix:long-form-action", {
                  detail: {
                    kind: "select",
                    analysisAssetId,
                    candidateId: candidate.id,
                    cleanupMode: "conservative",
                  },
                }))}
              >
                提炼成短片（默认精简）
              </button>
              <button
                type="button"
                aria-label={`保留“${candidate.title}”原话提炼`}
                onClick={() => window.dispatchEvent(new CustomEvent("multimix:long-form-action", {
                  detail: {
                    kind: "select",
                    analysisAssetId,
                    candidateId: candidate.id,
                    cleanupMode: "preserve_all",
                  },
                }))}
              >
                保留原话提炼
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
