"use client";

import Link from "next/link";
import { useState } from "react";

import { acceptLegalConsent } from "../../lib/api";
import BrandMark from "../components/brand-mark";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from "./legal-content";

// Shown after sign-in when the account has not accepted the current terms and
// privacy policy. Nothing in the workspace is reachable until the user agrees
// or signs out.
export function LegalConsentGate({
  token,
  onAccepted,
  onLogout,
}: {
  token: string;
  onAccepted: () => void;
  onLogout: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const status = await acceptLegalConsent(token, LEGAL_VERSION);
      if (status.legal_consent_required === true) {
        setError("同意记录未保存，请刷新页面后重试。");
        return;
      }
      onAccepted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同意记录未保存，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="multimix-auth-shell">
      <section className="multimix-auth-card" aria-labelledby="legal-consent-title">
        <div className="multimix-auth-brand">
          <BrandMark className="multimix-auth-brand-mark" size={34} />
          <b>MultiMix</b>
        </div>
        <h1 id="legal-consent-title" className="multimix-auth-title">服务条款与隐私政策已更新</h1>
        <p className="multimix-auth-sub">
          新版本于 {LEGAL_EFFECTIVE_DATE} 生效。请阅读后确认同意，再继续使用 MultiMix。
        </p>
        <label className="multimix-auth-consent">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            我已阅读并同意 <Link href="/legal/terms" target="_blank">《服务条款》</Link> 与{" "}
            <Link href="/legal/privacy" target="_blank">《隐私政策》</Link>
          </span>
        </label>
        {error ? <p className="multimix-auth-error" role="alert">{error}</p> : null}
        <button
          className="multimix-auth-submit"
          type="button"
          disabled={!agreed || submitting}
          onClick={() => void handleAccept()}
        >
          {submitting ? "处理中..." : "同意并继续"}
        </button>
        <p className="multimix-auth-switch">
          不同意？<button type="button" onClick={onLogout}>退出登录</button>
        </p>
      </section>
    </main>
  );
}
