"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AssetsWorkspaceClient from "./assets/components/assets-workspace-client";
import { authLogin, authRegister, isApiConfigured } from "../lib/api";

const LOCAL_USER_KEY = "multimix_local_user";
const DEFAULT_LOCAL_USER: LocalUser = {
  email: "demo@multimix.local"
};

type LocalUser = {
  email: string;
  token?: string | null;
};

export default function MultiMixApp({ basePath }: { basePath: string }) {
  return (
    <Suspense fallback={<MultiMixLoading />}>
      <MultiMixAppContent basePath={basePath} />
    </Suspense>
  );
}

function MultiMixAppContent({ basePath }: { basePath: string }) {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<LocalUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(LOCAL_USER_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as LocalUser;
        if (!parsed.email || parsed.email === "pilot@multimix.local") {
          window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
          setUser(DEFAULT_LOCAL_USER);
        } else {
          setUser(parsed);
        }
      } catch {
        window.localStorage.removeItem(LOCAL_USER_KEY);
        window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
        setUser(DEFAULT_LOCAL_USER);
      }
    } else if (isApiConfigured) {
      // With a real backend, require an explicit sign-in to obtain a token.
      setUser(null);
    } else {
      window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
      setUser(DEFAULT_LOCAL_USER);
    }
    setReady(true);
  }, []);

  if (!ready) return <MultiMixLoading />;

  if (!user) {
    return (
      <MultiMixLocalAuth
        onAuthed={(nextUser) => {
          window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(nextUser));
          setUser(nextUser);
        }}
      />
    );
  }

  return (
    <AssetsWorkspaceClient
      accountEmail={user.email}
      token={user.token ?? null}
      basePath={basePath}
      initialConversationId={searchParams.get("conversation") ?? undefined}
      initialProductId={searchParams.get("product") ?? undefined}
    />
  );
}

function MultiMixLoading() {
  return (
    <main className="multimix-auth-shell">
      <section className="multimix-auth-card" aria-busy="true">
        <div className="multimix-auth-brand">
          <span aria-hidden="true">M</span>
          <div>
            <strong>MultiMix</strong>
            <small>内容生成工作台</small>
          </div>
        </div>
        <div className="multimix-auth-loading" role="status">正在载入...</div>
      </section>
    </main>
  );
}

function MultiMixLocalAuth({ onAuthed }: { onAuthed: (user: LocalUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(isApiConfigured ? "" : DEFAULT_LOCAL_USER.email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedEmail = email.trim() || DEFAULT_LOCAL_USER.email;

    // Offline mock mode: no backend, accept any email without a token.
    if (!isApiConfigured) {
      onAuthed({ email: trimmedEmail });
      return;
    }

    setSubmitting(true);
    try {
      const response = mode === "login"
        ? await authLogin(trimmedEmail, password)
        : await authRegister(trimmedEmail, password);
      if (response.verification_required || !response.access_token) {
        setError(response.message ?? "需要邮箱验证后才能登录。");
        return;
      }
      onAuthed({ email: response.email ?? trimmedEmail, token: response.access_token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="multimix-auth-shell">
      <section className="multimix-auth-card">
        <div className="multimix-auth-brand">
          <span aria-hidden="true">M</span>
          <div>
            <strong>MultiMix</strong>
            <small>内容生成工作台</small>
          </div>
        </div>

        <section className="auth-panel auth-panel-modal">
          <div className="segmented auth-mode" role="tablist" aria-label={mode === "login" ? "登录" : "注册"}>
            <button className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")} type="button" role="tab" aria-selected={mode === "login"}>
              登录
            </button>
            <button className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")} type="button" role="tab" aria-selected={mode === "register"}>
              注册
            </button>
          </div>

          <form onSubmit={submit}>
            <label>
              邮箱
              <input name="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                required={isApiConfigured}
                minLength={mode === "register" ? 10 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <p className="multimix-auth-error" role="alert">{error}</p> : null}
            <button className="primary-action full-width" type="submit" disabled={submitting}>
              {submitting ? "处理中..." : mode === "login" ? "登录 MultiMix" : "注册 MultiMix"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
