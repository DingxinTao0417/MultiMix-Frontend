"use client";

import { useEffect, useRef, useState } from "react";
import { apiErrorStatus } from "../../../lib/api";
import styles from "./creative-memory-ui.module.css";

import {
  getCreativeCandidates,
  getCreativeProfile,
  patchCreativeProfile,
  resolveCreativeCandidates,
  type CreativeCandidateBatch,
  type CreativeCandidateDecision,
  type CreativeMemoryCandidate,
} from "../lib/creative-memory-api";

const MAX_POLLS = 6;
const POLL_INTERVAL_MS = 2_000;

const kindLabels: Record<CreativeMemoryCandidate["kind"], string> = {
  topic: "内容方向",
  audience: "目标受众",
  expression_preference: "表达偏好",
  must_follow: "长期要求",
  avoid: "希望避免",
};

function decisionKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `decision-${Date.now()}-${Math.random()}`;
}

export default function CreativeMemoryPrompt({
  token, assetId, completed,
}: { token: string; assetId: number; completed: boolean }) {
  const [batch, setBatch] = useState<CreativeCandidateBatch | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showFrequencyChoice, setShowFrequencyChoice] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const pendingDecision = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    setBatch(null);
    setSelected(new Set());
    setRevision(null);
    setShowFrequencyChoice(false);
    setSavedCount(0);
    setError("");
    pendingDecision.current = null;
    if (!completed) return () => { active = false; };

    const load = async () => {
      attempts += 1;
      try {
        const response = await getCreativeCandidates(token, assetId);
        if (!active) return;
        if (response.status === "ready" && response.candidates.length > 0) {
          const profile = await getCreativeProfile(token);
          if (!active) return;
          setRevision(profile.revision);
          setBatch(response);
          return;
        }
        if (["none", "queued", "running"].includes(response.status) && attempts < MAX_POLLS) {
          timer = setTimeout(() => { void load(); }, POLL_INTERVAL_MS);
        }
      } catch {
        // Candidate work is optional: video completion and playback never fail here.
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [assetId, completed, token]);

  const candidates = batch?.status === "ready" ? batch.candidates : [];

  async function submit(decisions: CreativeCandidateDecision[]) {
    if (busy || revision === null || decisions.length === 0) return;
    setBusy(true);
    setError("");
    const signature = JSON.stringify({ revision, decisions });
    const key = pendingDecision.current?.signature === signature
      ? pendingDecision.current.key
      : decisionKey();
    pendingDecision.current = { signature, key };
    try {
      const result = await resolveCreativeCandidates(token, {
        expected_revision: revision,
        idempotency_key: key,
        decisions,
      });
      pendingDecision.current = null;
      setSavedCount(decisions.filter((decision) => decision.action === "accepted").length);
      setRevision(result.revision);
      const decided = new Set(decisions.map((decision) => decision.candidate_id));
      const remaining = candidates.filter((candidate) => !decided.has(candidate.id));
      setBatch(remaining.length ? { ...batch!, candidates: remaining } : null);
      setSelected((current) => new Set([...current].filter((id) => !decided.has(id))));
      if (decisions.every((decision) => decision.action === "dismissed")
        && result.dismissal_streak === 2) {
        setShowFrequencyChoice(true);
      }
    } catch (failure) {
      if (apiErrorStatus(failure) === 409) {
        pendingDecision.current = null;
        try {
          const [currentProfile, currentBatch] = await Promise.all([
            getCreativeProfile(token), getCreativeCandidates(token, assetId),
          ]);
          setRevision(currentProfile.revision);
          setBatch(currentBatch.status === "ready" && currentBatch.candidates.length
            ? currentBatch : null);
          const currentIds = new Set(currentBatch.candidates.map((candidate) => candidate.id));
          setSelected((previous) => new Set([...previous].filter((id) => currentIds.has(id))));
          setError("档案有更新，请核对后重试。");
        } catch {
          setError("未能刷新创作档案，请稍后重试。");
        }
      } else {
        setError("未能保存这次选择，请重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  async function chooseFrequency(mode: "reduced" | "off") {
    if (busy || revision === null) return;
    setBusy(true);
    setError("");
    try {
      const updated = await patchCreativeProfile(token, {
        expected_revision: revision,
        candidate_prompt_mode: mode,
      });
      setRevision(updated.revision);
      setShowFrequencyChoice(false);
    } catch {
      setError("设置未保存，请重试。");
    } finally {
      setBusy(false);
    }
  }

  if (showFrequencyChoice) {
    return (
      <section role="region" aria-label="创作档案提醒设置" className={styles.card}>
        <strong>想减少这类提醒吗？</strong>
        <p className={styles.description}>由你决定，系统不会自行更改提醒偏好。</p>
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => void chooseFrequency("reduced")} className={styles.secondaryButton}>降低提醒频率</button>
          <button type="button" disabled={busy} onClick={() => void chooseFrequency("off")} className={styles.secondaryButton}>关闭提醒</button>
          <button type="button" disabled={busy} onClick={() => setShowFrequencyChoice(false)} className={styles.textButton}>保持现状</button>
        </div>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </section>
    );
  }
  if (!candidates.length) {
    return savedCount > 0
      ? <p role="status" className={styles.saved}>已保存到创作档案 · {savedCount} 项</p>
      : null;
  }

  return (
    <section role="region" aria-label="保存创作偏好" className={styles.card}>
      <div>
        <strong className={styles.title}>这些创作偏好要留给以后使用吗？</strong>
        <p className={styles.description}>来自本次创作。只有你确认保存后，才会用于以后的新视频；本次作品不会改变。</p>
      </div>
      <div className={styles.candidateList}>
        {candidates.map((candidate) => (
          <div key={candidate.id} className={styles.candidate}>
            <label className={styles.candidateLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                aria-label={`保存${candidate.value}`}
                checked={selected.has(candidate.id)}
                disabled={busy}
                onChange={(event) => setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(candidate.id);
                  else next.delete(candidate.id);
                  return next;
                })}
              />
              <span className={styles.candidateText}><span className={styles.kind}>{kindLabels[candidate.kind]}</span>{candidate.value}</span>
            </label>
            <button type="button" disabled={busy} onClick={() => void submit([{ candidate_id: candidate.id, action: "rejected" }])} className={styles.rejectButton}>不要再建议这项</button>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => void submit(candidates.map((candidate) => ({
            candidate_id: candidate.id,
            action: selected.has(candidate.id) ? "accepted" : "dismissed",
          })))}
          className={styles.primaryButton}
        >保存 {selected.size} 项</button>
        <button type="button" disabled={busy} onClick={() => void submit(candidates.map((candidate) => ({ candidate_id: candidate.id, action: "dismissed" })))} className={styles.secondaryButton}>这次先不处理</button>
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
  );
}
