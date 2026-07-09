"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AssetsWorkspaceClient from "./assets/components/assets-workspace-client";
import type { ActiveView } from "./assets/lib/asset-workspace-shared";
import { isApiConfigured, API_AUTH_EXPIRED_EVENT } from "../lib/api";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

const LOCAL_USER_KEY = "multimix_local_user";
const DEFAULT_LOCAL_USER: LocalUser = {
  email: "demo@multimix.local"
};
const AUTH_INIT_TIMEOUT_MS = 4000;

type LocalUser = {
  email: string;
  token?: string | null;
};

function activeViewFromParam(value: string | null): ActiveView | undefined {
  if (value === "assets" || value === "copy" || value === "image" || value === "video") return value;
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("auth_init_timeout"));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    window.localStorage.removeItem(LOCAL_USER_KEY);
    setUser(null);
  };

  useEffect(() => {
    const onExpired = () => { void handleLogout(); };
    window.addEventListener(API_AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(API_AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const finishReady = () => {
      if (!cancelled) setReady(true);
    };
    const setDefaultLocalUser = () => {
      if (cancelled) return;
      window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
      setUser(DEFAULT_LOCAL_USER);
      setReady(true);
    };

    if (isSupabaseConfigured && supabase) {
      // Try to restore Supabase session.
      const timeout = window.setTimeout(() => {
        setDefaultLocalUser();
      }, AUTH_INIT_TIMEOUT_MS);
      supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        if (data.session) {
          const u: LocalUser = { email: data.session.user.email ?? "", token: data.session.access_token };
          window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(u));
          setUser(u);
        }
        setReady(true);
      }).catch(() => {
        window.clearTimeout(timeout);
        setDefaultLocalUser();
      });
      // Listen for auth state changes (token refresh, sign out).
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        if (session) {
          const u: LocalUser = { email: session.user.email ?? "", token: session.access_token };
          window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(u));
          setUser(u);
        } else {
          window.localStorage.removeItem(LOCAL_USER_KEY);
          setUser(null);
        }
      });
      return () => {
        cancelled = true;
        window.clearTimeout(timeout);
        subscription.unsubscribe();
      };
    }

    // Non-Supabase with a backend: always refresh the local dev token so stale
    // Supabase sessions from earlier runs cannot force a password login.
    if (isApiConfigured) {
      window.localStorage.removeItem(LOCAL_USER_KEY);
      void import("../lib/api")
        .then(({ authLocalDevAdmin }) => withTimeout(authLocalDevAdmin(), AUTH_INIT_TIMEOUT_MS))
        .then((response) => {
          if (cancelled) return;
          if (response.access_token) {
            const nextUser = { email: response.email ?? "local@admin", token: response.access_token };
            window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(nextUser));
            setUser(nextUser);
          } else {
            setUser(null);
          }
        })
        .catch(() => {
          if (!cancelled) setUser(null);
        })
        .finally(() => {
          finishReady();
        });
      return () => {
        cancelled = true;
      };
    }

    // No backend: read from localStorage for the mock-only workspace.
    const stored = window.localStorage.getItem(LOCAL_USER_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as LocalUser;
        if (parsed.token || !isApiConfigured) {
          if (!parsed.email || parsed.email === "pilot@multimix.local") {
            window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
            setUser(DEFAULT_LOCAL_USER);
          } else {
            setUser(parsed);
          }
          finishReady();
          return;
        }
        window.localStorage.removeItem(LOCAL_USER_KEY);
      } catch {
        window.localStorage.removeItem(LOCAL_USER_KEY);
        if (!isApiConfigured) {
          window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
          setUser(DEFAULT_LOCAL_USER);
          finishReady();
          return;
        }
      }
    }

    {
      window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(DEFAULT_LOCAL_USER));
      setUser(DEFAULT_LOCAL_USER);
      finishReady();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return <MultiMixLoading />;

  if (!user) {
    return (
      <MultiMixAuth
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
      onLogout={() => { void handleLogout(); }}
      initialConversationId={searchParams.get("conversation") ?? undefined}
      initialProductId={searchParams.get("product") ?? undefined}
      initialView={activeViewFromParam(searchParams.get("view"))}
    />
  );
}

function MultiMixBrand() {
  return (
    <div className="multimix-auth-brand">
      <span className="multimix-auth-brand-mark" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 14 14" fill="none"><path d="M2 12V2.5L7 8l5-5.5V12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <b>MultiMix</b>
    </div>
  );
}

function MultiMixLoading() {
  return (
    <main className="multimix-auth-shell">
      <section className="multimix-auth-card" aria-busy="true">
        <MultiMixBrand />
        <div className="multimix-auth-loading" role="status">正在载入...</div>
      </section>
    </main>
  );
}

function MultiMixAuth({ onAuthed }: { onAuthed: (user: LocalUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Demo-final login shell: the demo-mode entry only exists where local mode
  // is actually reachable (Supabase not configured); password reset only where
  // Supabase can send the email (§12 数据不在就不渲染).
  const canDemoEntry = !isSupabaseConfigured;
  const canResetPassword = isSupabaseConfigured && Boolean(supabase);

  async function handleDemoEntry() {
    setError(null);
    setNotice(null);
    if (isApiConfigured) {
      setSubmitting(true);
      try {
        const { authLocalDevAdmin } = await import("../lib/api");
        const response = await authLocalDevAdmin();
        if (response.access_token) {
          onAuthed({ email: response.email ?? "demo@multimix.local", token: response.access_token });
          return;
        }
        setError("本地演示模式登录失败，请检查后端。");
      } catch (err) {
        setError(err instanceof Error ? err.message : "本地演示模式登录失败。");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    onAuthed({ email: "demo@multimix.local" });
  }

  async function handleForgotPassword() {
    if (!supabase) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("先填写邮箱，再点「忘记密码」。");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(trimmedEmail);
      if (err) {
        setError(err.message);
        return;
      }
      setNotice("重置链接已发送到你的邮箱。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送重置邮件失败，请稍后重试。");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("请填写邮箱和密码。");
      return;
    }

    // Offline mock mode: no backend, accept any email.
    if (!isApiConfigured && !isSupabaseConfigured) {
      onAuthed({ email: trimmedEmail });
      return;
    }

    setSubmitting(true);
    try {
      if (isSupabaseConfigured && supabase) {
        // Supabase Auth.
        if (mode === "register") {
          const { data, error: err } = await supabase.auth.signUp({ email: trimmedEmail, password });
          if (err) { setError(err.message); return; }
          if (data.session) {
            onAuthed({ email: data.session.user.email ?? trimmedEmail, token: data.session.access_token });
          } else {
            setError("注册成功，请检查邮箱确认后登录。");
          }
        } else {
          const { data, error: err } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
          if (err) { setError(err.message); return; }
          if (data.session) {
            onAuthed({ email: data.session.user.email ?? trimmedEmail, token: data.session.access_token });
          } else {
            setError("登录失败，请重试。");
          }
        }
      } else {
        // Local backend auth (fallback).
        const { authLogin, authRegister } = await import("../lib/api");
        const response = mode === "login"
          ? await authLogin(trimmedEmail, password)
          : await authRegister(trimmedEmail, password);
        if (response.verification_required || !response.access_token) {
          setError(response.message ?? "需要邮箱验证后才能登录。");
          return;
        }
        onAuthed({ email: response.email ?? trimmedEmail, token: response.access_token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="multimix-auth-shell">
      <section className="multimix-auth-card">
        <MultiMixBrand />
        <h1 className="multimix-auth-title">{mode === "login" ? "登录你的创作工作台" : "注册你的创作工作台"}</h1>
        <p className="multimix-auth-sub">用真实素材，生成能直接发布的内容</p>

        <form onSubmit={submit}>
          <label className="multimix-auth-field">
            <span>邮箱或手机号</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="multimix-auth-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              required
              placeholder="••••••••"
              minLength={mode === "register" ? 6 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {canResetPassword && mode === "login" ? (
            <p className="multimix-auth-forgot">
              <button type="button" onClick={() => void handleForgotPassword()}>忘记密码？</button>
            </p>
          ) : null}
          {error ? <p className="multimix-auth-error" role="alert">{error}</p> : null}
          {notice ? <p className="multimix-auth-notice" role="status">{notice}</p> : null}
          <button className="multimix-auth-submit" type="submit" disabled={submitting}>
            {submitting ? "处理中..." : mode === "login" ? "登录" : "注册"}
          </button>
        </form>

        <p className="multimix-auth-switch">
          {mode === "login" ? (
            <>没有账号？<button type="button" onClick={() => { setMode("register"); setError(null); setNotice(null); }}>注册</button></>
          ) : (
            <>已有账号？<button type="button" onClick={() => { setMode("login"); setError(null); setNotice(null); }}>登录</button></>
          )}
        </p>

        {canDemoEntry ? (
          <>
            <div className="multimix-auth-divider" aria-hidden="true">或</div>
            <button className="multimix-auth-demo" type="button" disabled={submitting} onClick={() => void handleDemoEntry()}>
              <span className="multimix-auth-gdot" aria-hidden="true" />
              本地演示模式直接进入
            </button>
          </>
        ) : null}

        <p className="multimix-auth-foot">
          登录即代表同意《服务条款》与《隐私政策》
          <br />
          未配置 Supabase 时自动进入本地模式
        </p>
      </section>
    </main>
  );
}
