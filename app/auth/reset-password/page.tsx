"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

function hasRecoveryEvidence(): boolean {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return Boolean(
    query.get("code")
    || query.get("token_hash")
    || query.get("type") === "recovery"
    || hash.get("type") === "recovery"
    || hash.get("access_token")
  );
}

export default function ResetPasswordPage() {
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setState("invalid");
      return;
    }

    let active = true;
    const recoveryEvidence = hasRecoveryEvidence();
    const timeout = window.setTimeout(() => {
      if (active) setState("invalid");
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        window.clearTimeout(timeout);
        setState("ready");
      }
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || sessionError) return;
      if (recoveryEvidence && data.session) {
        window.clearTimeout(timeout);
        setState("ready");
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!supabase || state !== "ready") {
      setError("重置链接无效或已过期，请重新申请。");
      return;
    }
    if (password.length < 8) {
      setError("新密码至少需要 8 个字符。");
      return;
    }
    if (password !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      await supabase.auth.signOut({ scope: "local" });
      window.history.replaceState({}, "", "/auth/reset-password");
      setPassword("");
      setConfirmation("");
      setState("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码更新失败，请重新申请重置链接。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="multimix-auth-shell">
      <section className="multimix-auth-card">
        <div className="multimix-auth-brand">
          <span className="multimix-auth-brand-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 14 14" fill="none"><path d="M2 12V2.5L7 8l5-5.5V12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <b>MultiMix</b>
        </div>

        {state === "checking" ? (
          <div className="multimix-auth-loading" role="status">正在验证重置链接...</div>
        ) : state === "invalid" ? (
          <>
            <h1 className="multimix-auth-title">重置链接无效或已过期</h1>
            <p className="multimix-auth-sub">返回登录页，填写邮箱后重新申请重置链接。</p>
            <Link className="multimix-auth-submit multimix-auth-submit-link" href="/">返回登录</Link>
          </>
        ) : state === "success" ? (
          <>
            <h1 className="multimix-auth-title">密码已更新</h1>
            <p className="multimix-auth-sub">请使用新密码重新登录。旧密码将不再有效。</p>
            <Link className="multimix-auth-submit multimix-auth-submit-link" href="/">返回登录</Link>
          </>
        ) : (
          <>
            <h1 className="multimix-auth-title">设置新密码</h1>
            <p className="multimix-auth-sub">使用至少 8 个字符，并避免与其他网站共用密码。</p>
            <form onSubmit={submit}>
              <label className="multimix-auth-field">
                <span>新密码</span>
                <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label className="multimix-auth-field">
                <span>再次输入新密码</span>
                <input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              {error ? <p className="multimix-auth-error" role="alert">{error}</p> : null}
              <button className="multimix-auth-submit" type="submit" disabled={submitting}>{submitting ? "正在更新..." : "更新密码"}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
