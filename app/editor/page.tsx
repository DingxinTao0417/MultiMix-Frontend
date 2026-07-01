"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

// The OpenCut editor relies heavily on browser-only APIs (WebCodecs, AudioContext,
// OffscreenCanvas, IndexedDB, Web Workers), so it must never render on the server.
const EditorView = dynamic(() => import("./EditorView"), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: "#888" }}>正在加载剪辑器…</div>
});

const LOCAL_USER_KEY = "multimix_local_user";

function readToken(): string | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string | null };
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

function EditorPageContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job");
  const assetId = searchParams.get("asset");
  const embed = searchParams.get("embed") === "1";
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(readToken());
    setReady(true);
  }, []);

  if (!ready) return <div style={{ padding: 24, color: "#888" }}>正在加载…</div>;
  return <EditorView jobId={jobId} assetId={assetId} token={token} embed={embed} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "#888" }}>正在加载…</div>}>
      <EditorPageContent />
    </Suspense>
  );
}
