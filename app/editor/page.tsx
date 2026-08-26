"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

// The OpenCut editor relies heavily on browser-only APIs (WebCodecs, AudioContext,
// OffscreenCanvas, IndexedDB, Web Workers), so it must never render on the server.
const EditorView = dynamic(() => import("./EditorView"), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: "#888" }}>正在加载剪辑器…</div>
});

const LOCAL_USER_KEY = "multimix_local_user";

function readLocalToken(): string | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string | null };
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

async function readToken(): Promise<string | null> {
  // Supabase auth mode stores the session in the Supabase client, not under
  // the local-user key. Read it first so a refreshed session wins over the
  // compatibility projection in localStorage.
  try {
    const { supabase } = await import("@/lib/supabase");
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) return data.session.access_token;
    }
  } catch {
    // Local auth mode and a temporarily unavailable Supabase client both use
    // the existing compatibility token below.
  }
  return readLocalToken();
}

function EditorPageContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const assetId = searchParams.get("asset");
  const embed = searchParams.get("embed") === "1";
  const mode = searchParams.get("mode") === "preview" ? "preview" : "edit";
  const previewChannel = searchParams.get("previewChannel");
  const initialSegmentId = searchParams.get("segment");
  const openMaterialPicker = searchParams.get("replace") === "1";
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const { supabase } = await import("@/lib/supabase");
      if (!supabase) return readLocalToken();
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session?.access_token) return null;
      setToken(data.session.access_token);
      return data.session.access_token;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeAuth: () => void = () => undefined;
    const onStorage = (event: StorageEvent) => {
      if (!cancelled && event.key === LOCAL_USER_KEY) setToken(readLocalToken());
    };
    window.addEventListener("storage", onStorage);
    void readToken().then((value) => {
      if (cancelled) return;
      setToken(value);
      setReady(true);
    });
    void import("@/lib/supabase").then(({ supabase }) => {
      if (!supabase) return;
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setToken(session?.access_token ?? readLocalToken());
      });
      if (cancelled) {
        subscription.unsubscribe();
      } else {
        unsubscribeAuth = () => subscription.unsubscribe();
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unsubscribeAuth();
    };
  }, []);

  if (!ready) return <div style={{ padding: 24, color: "#888" }}>正在加载…</div>;
  return (
    <EditorView
      jobId={jobId}
      assetId={assetId}
      token={token}
      refreshAccessToken={refreshAccessToken}
      embed={embed}
      mode={mode}
      previewChannel={previewChannel}
      initialSegmentId={initialSegmentId}
      openMaterialPicker={openMaterialPicker}
    />
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "#888" }}>正在加载…</div>}>
      <EditorPageContent />
    </Suspense>
  );
}
