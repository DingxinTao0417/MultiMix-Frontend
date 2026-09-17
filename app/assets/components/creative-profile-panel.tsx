"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { apiErrorStatus } from "../../../lib/api";
import styles from "./creative-memory-ui.module.css";
import {
  clearCreativeProfile,
  creativeSnapshotForProduct,
  deleteCreativeProfileItem,
  getCreativeProjectUsage,
  getCreativeProfile,
  getCreativeSuppressions,
  patchCreativeProfile,
  restoreCreativeSuppression,
  setCreativeProjectUsage,
  type CreativeMemoryItem,
  type CreativeMemoryKind,
  type CreativeProfile,
  type CreativeSuppression,
  type CreativeProjectUsage as CreativeProjectUsageState,
} from "../lib/creative-memory-api";

type Props = { token: string; onClose: () => void };
type Group = { title: string; kinds: CreativeMemoryKind[] };

const GROUPS: Group[] = [
  { title: "关于你或你的品牌", kinds: ["identity", "confirmed_fact"] },
  { title: "内容与受众", kinds: ["topic", "audience"] },
  { title: "表达偏好", kinds: ["expression_preference"] },
  { title: "必须遵守", kinds: ["must_follow"] },
  { title: "希望避免", kinds: ["avoid"] },
];

const KIND_LABELS: Record<CreativeMemoryKind, string> = {
  identity: "关于你或你的品牌",
  topic: "内容方向",
  audience: "目标受众",
  expression_preference: "表达偏好",
  confirmed_fact: "已确认事实",
  must_follow: "必须遵守",
  avoid: "希望避免",
};

function messageForError(error: unknown): string {
  if (apiErrorStatus(error) === 409) return "档案已在别处更新，请检查后重试。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export default function CreativeProfilePanel({ token, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<CreativeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<"profile" | "form" | "ignored">("profile");
  const [suppressions, setSuppressions] = useState<CreativeSuppression[]>([]);
  const [editing, setEditing] = useState<CreativeMemoryItem | null>(null);
  const [kind, setKind] = useState<CreativeMemoryKind>("topic");
  const [key, setKey] = useState<"display_name" | "description">("display_name");
  const [value, setValue] = useState("");
  const [deleting, setDeleting] = useState<CreativeMemoryItem | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearingIgnored, setClearingIgnored] = useState(false);
  const [suppressOnClear, setSuppressOnClear] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCreativeProfile(token)
      .then((data) => { if (!cancelled) setProfile(data); })
      .catch((cause) => { if (!cancelled) setError(messageForError(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [token, onClose]);

  async function runAction(action: () => Promise<CreativeProfile>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      const updated = await action();
      setProfile(updated);
      after?.();
    } catch (cause) {
      setError(messageForError(cause));
      if (apiErrorStatus(cause) === 409) {
        try {
          setProfile(await getCreativeProfile(token));
        } catch {
          // Preserve the original conflict message and unsaved form input.
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function openForm(item: CreativeMemoryItem | null) {
    setEditing(item);
    setKind(item?.kind ?? "topic");
    setKey(item?.key === "description" ? "description" : "display_name");
    setValue(item?.value ?? "");
    setError("");
    setScreen("form");
  }

  function saveForm() {
    if (!profile || !value.trim()) return;
    void runAction(
      () => patchCreativeProfile(token, {
        expected_revision: profile.revision,
        upsert_items: [{
          ...(editing ? { id: editing.id } : {}),
          kind,
          key: kind === "identity" ? key : null,
          value: value.trim(),
        }],
      }),
      () => {
        setScreen("profile");
        setEditing(null);
        setValue("");
      },
    );
  }

  async function openIgnored() {
    setScreen("ignored");
    setError("");
    try {
      setSuppressions(await getCreativeSuppressions(token));
    } catch (cause) {
      setError(messageForError(cause));
    }
  }

  function removeItem(item: CreativeMemoryItem, suppress: boolean) {
    if (!profile) return;
    void runAction(
      () => deleteCreativeProfileItem(token, item.id, {
        expected_revision: profile.revision,
        suppress_future_suggestions: suppress,
      }),
      () => setDeleting(null),
    );
  }

  function restoreSuppression(entry: CreativeSuppression) {
    if (!profile) return;
    void runAction(
      () => restoreCreativeSuppression(token, entry.id, { expected_revision: profile.revision }),
      () => setSuppressions((previous) => previous.filter((item) => item.id !== entry.id)),
    );
  }

  async function clearIgnored() {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      let updated = profile;
      for (const entry of suppressions) {
        updated = await restoreCreativeSuppression(token, entry.id, {
          expected_revision: updated.revision,
        });
      }
      setProfile(updated);
      setSuppressions([]);
      setClearingIgnored(false);
    } catch (cause) {
      setError(messageForError(cause));
      try {
        const [latestProfile, latestSuppressions] = await Promise.all([
          getCreativeProfile(token),
          getCreativeSuppressions(token),
        ]);
        setProfile(latestProfile);
        setSuppressions(latestSuppressions);
      } catch {
        // Keep the action error visible; the next open retries both reads.
      }
    } finally {
      setBusy(false);
    }
  }

  function saveSetting(changes: { enabled?: boolean; candidate_prompt_mode?: CreativeProfile["candidate_prompt_mode"] }) {
    if (!profile) return;
    void runAction(() => patchCreativeProfile(token, {
      expected_revision: profile.revision,
      ...changes,
    }));
  }

  return (
    <div className="creative-profile-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="creative-profile-panel" role="dialog" aria-modal="true" aria-label="创作档案">
        <header className="creative-profile-header">
          <div>
            <span className="creative-profile-eyebrow">创作记忆</span>
            <h2>创作档案</h2>
          </div>
          <button ref={closeRef} type="button" className="creative-profile-icon-button" aria-label="关闭创作档案" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="creative-profile-scroll">
          <p className="creative-profile-intro">只保存你确认过、适合以后继续使用的内容。单次视频要求不会自动写入档案。</p>
          {error ? <p className="creative-profile-error" role="alert">{error}</p> : null}
          {loading ? <p className="creative-profile-muted">正在读取创作档案…</p> : null}

          {!loading && profile && screen === "profile" ? (
            <>
              {profile.profile.items.length === 0 ? (
                <div className="creative-profile-empty">
                  <h3>从第一个作品开始</h3>
                  <p>完成视频后，MultiMix 会把可能长期有用的偏好交给你确认。你也可以先手动添加。</p>
                  <button type="button" className="creative-profile-secondary" onClick={() => openForm(null)}>手动添加</button>
                </div>
              ) : (
                <>
                  {GROUPS.map((group) => {
                    const items = profile.profile.items.filter((item) => group.kinds.includes(item.kind));
                    if (!items.length) return null;
                    return (
                      <section className="creative-profile-group" key={group.title}>
                        <h3>{group.title}</h3>
                        {items.map((item) => (
                          <div className="creative-profile-item" key={item.id}>
                            <div>
                              <span>{item.kind === "identity" ? (item.key === "description" ? "简介" : "名称") : KIND_LABELS[item.kind]}</span>
                              <p>{item.value}</p>
                              {item.source.type === "confirmed_candidate" ? <small>视频完成后由你确认保存</small> : null}
                            </div>
                            <div className="creative-profile-item-actions">
                              <button type="button" disabled={busy} aria-label={`编辑${item.value}`} onClick={() => openForm(item)}>编辑</button>
                              <button type="button" disabled={busy} aria-label={`删除${item.value}`} onClick={() => setDeleting(item)}>删除</button>
                            </div>
                          </div>
                        ))}
                      </section>
                    );
                  })}
                  <button type="button" className="creative-profile-secondary" onClick={() => openForm(null)}>手动添加</button>
                </>
              )}

              {deleting ? (
                <div className="creative-profile-confirm" role="group" aria-label={`删除${deleting.value}`}>
                  <p>删除“{deleting.value}”后，你可以选择是否以后还要看到相似建议。</p>
                  <div>
                    <button type="button" disabled={busy} onClick={() => removeItem(deleting, false)}>仅删除</button>
                    <button type="button" disabled={busy} onClick={() => removeItem(deleting, true)}>删除且不再建议</button>
                    <button type="button" disabled={busy} onClick={() => setDeleting(null)}>取消</button>
                  </div>
                </div>
              ) : null}

              <section className="creative-profile-settings">
                <h3>使用与提醒</h3>
                <label className="creative-profile-setting-line">
                  <span>在新视频中使用创作档案</span>
                  <input type="checkbox" checked={profile.enabled} disabled={busy} onChange={(event) => saveSetting({ enabled: event.target.checked })} />
                </label>
                <label className="creative-profile-setting-line">
                  <span>完成后提醒频率</span>
                  <select aria-label="完成后提醒频率" value={profile.candidate_prompt_mode} disabled={busy} onChange={(event) => saveSetting({ candidate_prompt_mode: event.target.value as CreativeProfile["candidate_prompt_mode"] })}>
                    <option value="normal">正常</option>
                    <option value="reduced">降低频率</option>
                    <option value="off">关闭提醒</option>
                  </select>
                </label>
                <p>关闭提醒不会删除已保存的档案。临时项目也可以单独选择不使用。</p>
              </section>

              <div className="creative-profile-footer-actions">
                <button type="button" onClick={() => void openIgnored()}>已忽略建议</button>
                <button type="button" disabled={busy || profile.profile.items.length === 0} onClick={() => setClearing(true)}>清空档案</button>
              </div>
              {clearing ? (
                <div className="creative-profile-confirm" role="group" aria-label="确认清空档案">
                  <p>清空后，新视频不再使用这些条目；已有作品不会改变。</p>
                  <label><input type="checkbox" checked={suppressOnClear} onChange={(event) => setSuppressOnClear(event.target.checked)} /> 删除且不再建议这些内容</label>
                  <div>
                    <button type="button" disabled={busy} onClick={() => void runAction(
                      () => clearCreativeProfile(token, { expected_revision: profile.revision, suppress_future_suggestions: suppressOnClear }),
                      () => setClearing(false),
                    )}>确认清空</button>
                    <button type="button" disabled={busy} onClick={() => setClearing(false)}>取消</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {!loading && profile && screen === "form" ? (
            <form className="creative-profile-form" onSubmit={(event) => { event.preventDefault(); saveForm(); }}>
              <button type="button" className="creative-profile-text-button" onClick={() => setScreen("profile")}>返回档案</button>
              <h3>{editing ? "编辑条目" : "手动添加"}</h3>
              <label>类别
                <select aria-label="类别" value={kind} disabled={busy || Boolean(editing)} onChange={(event) => setKind(event.target.value as CreativeMemoryKind)}>
                  {Object.entries(KIND_LABELS).map(([option, label]) => <option key={option} value={option}>{label}</option>)}
                </select>
              </label>
              {kind === "identity" ? (
                <label>信息类型
                  <select value={key} onChange={(event) => setKey(event.target.value as "display_name" | "description")}>
                    <option value="display_name">名称</option>
                    <option value="description">简介</option>
                  </select>
                </label>
              ) : null}
              <label>内容
                <textarea aria-label="内容" value={value} maxLength={500} onChange={(event) => setValue(event.target.value)} placeholder="写下以后创作中仍适用的内容" />
              </label>
              <p>已确认事实请只填写你能核实、愿意长期使用的内容。</p>
              <button type="submit" className="creative-profile-primary" disabled={busy || !value.trim()}>保存到创作档案</button>
            </form>
          ) : null}

          {!loading && profile && screen === "ignored" ? (
            <section className="creative-profile-ignored">
              <button type="button" className="creative-profile-text-button" onClick={() => setScreen("profile")}>返回档案</button>
              <h3>已忽略建议</h3>
              <p>这些内容不会再被自动建议。恢复后，未来视频仍可能再次出现相似建议。</p>
              {suppressions.length === 0 ? <p className="creative-profile-muted">暂无已忽略建议。</p> : (
                suppressions.map((entry) => (
                  <div className="creative-profile-item" key={entry.id}>
                    <p>{entry.value}</p>
                    <button type="button" disabled={busy} aria-label={`恢复${entry.value}`} onClick={() => restoreSuppression(entry)}>恢复</button>
                  </div>
                ))
              )}
              {suppressions.length ? (
                clearingIgnored ? (
                  <div className="creative-profile-confirm" role="group" aria-label="确认清空忽略记录">
                    <p>清空后，这些内容未来可能再次成为建议。</p>
                    <div>
                      <button type="button" disabled={busy} onClick={() => void clearIgnored()}>确认清空忽略记录</button>
                      <button type="button" disabled={busy} onClick={() => setClearingIgnored(false)}>取消</button>
                    </div>
                  </div>
                ) : <button type="button" className="creative-profile-text-button" onClick={() => setClearingIgnored(true)}>清空已忽略建议</button>
              ) : null}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}


export function CreativeProjectUsage({ token, conversationId, product }: {
  token: string;
  conversationId: string;
  product: { contentType?: string; metadata?: Record<string, unknown> };
}) {
  const [usage, setUsage] = useState<CreativeProjectUsageState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    getCreativeProjectUsage(token, conversationId)
      .then((result) => { if (!cancelled) setUsage(result); })
      .catch((cause) => { if (!cancelled) setError(messageForError(cause)); });
    return () => { cancelled = true; };
  }, [token, conversationId]);

  async function setIgnored(ignoreProfile: boolean) {
    setBusy(true);
    setError("");
    try {
      setUsage(await setCreativeProjectUsage(token, conversationId, ignoreProfile));
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!usage && !error) return null;
  const snapshot = creativeSnapshotForProduct(product);
  const items = snapshot?.selected_items ?? [];
  return (
    <section className={styles.projectUsage} aria-label="本作品创作档案使用情况">
      <div className={styles.usageHeader}>
        <button type="button" className={styles.usageButton} onClick={() => setOpen((value) => !value)} disabled={!usage}>
          {snapshot ? `本次使用创作档案 · ${items.length} 项` : "本作品未使用创作档案"}
        </button>
        {usage ? (
          <label className={styles.usageToggle}>
            <input className={styles.usageCheckbox} type="checkbox" checked={usage.ignoreProfile} disabled={busy} onChange={(event) => void setIgnored(event.target.checked)} />
            本项目不使用创作档案
          </label>
        ) : null}
      </div>
      {open && snapshot ? (
        <div className={styles.usageDetail}>
          {items.length ? (
            <ul>
              {items.map((item) => <li key={item.id}>{item.value}</li>)}
            </ul>
          ) : <p>本次没有采用档案条目。</p>}
          <p className={styles.usageNote}>展示的是本作品使用的档案快照，不会随账户档案变化而自动更新。</p>
        </div>
      ) : null}
      {usage?.ignoreProfile ? <p className={styles.usageNote}>只影响之后开始的新视频；已生成作品和其档案快照不会被改写。</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
