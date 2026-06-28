import { useEffect, useState } from "react";
import { useEditor } from "@editor/hooks/use-editor";
import type { MediaAsset } from "@editor/lib/media/types";
import { replaceOptions, generateMG, mediaUrl, type MaterialOption } from "./api";
import { segmentTextByElementId } from "./buildProject";

// Floating panel: when a video/image clip is selected, lets the user swap it
// for a freshly-searched alternative material for the same script segment.
export function ReplacePanel() {
  const editor = useEditor();
  const selected = useEditor((e) => e.selection.getSelectedElements());
  const tracks = useEditor((e) => e.timeline.getTracks());
  const canvasSize = useEditor((e) => e.project.getActiveOrNull()?.settings.canvasSize);

  // Derive layout + dimensions from the current project so replacements match.
  const projW = canvasSize?.width ?? 1080;
  const projH = canvasSize?.height ?? 1920;
  const projLayout = projW > projH ? "landscape" : projW === projH ? "square" : "portrait";

  const [options, setOptions] = useState<MaterialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [mgUrl, setMgUrl] = useState<string | null>(null);
  const [mgLoading, setMgLoading] = useState(false);

  // Resolve the single selected video/image element (if any).
  const sel = selected.length === 1 ? selected[0] : null;
  let selEl: { id: string; type: string; duration: number; trackId: string } | null = null;
  if (sel) {
    for (const t of tracks) {
      if (t.id !== sel.trackId) continue;
      const el = t.elements.find((x) => x.id === sel.elementId);
      if (el && (el.type === "video" || el.type === "image")) {
        selEl = { id: el.id, type: el.type, duration: el.duration, trackId: t.id };
      }
    }
  }

  // Clear options when selection changes.
  useEffect(() => {
    setOptions([]);
    setMgUrl(null);
  }, [selEl?.id]);

  if (!selEl) return null;
  const segText = segmentTextByElementId[selEl.id] || "";

  async function fetchOptions() {
    if (!selEl || !segText) return;
    setLoading(true);
    try {
      const opts = await replaceOptions(segText, selEl.duration, projLayout);
      setOptions(opts);
    } catch (e) {
      console.warn("replace options failed", e);
    } finally {
      setLoading(false);
    }
  }

  async function makeMG() {
    if (!selEl || !segText) return;
    setMgLoading(true);
    setMgUrl(null);
    try {
      const res = await generateMG(segText, selEl.duration, projW, projH, false);
      // Preview the generated MG HTML animation in an iframe.
      setMgUrl(mediaUrl(res.html_path));
    } catch (e) {
      console.warn("generate MG failed", e);
    } finally {
      setMgLoading(false);
    }
  }

  async function applyReplace(opt: MaterialOption) {
    if (!selEl) return;
    // Download the new material into a File so mediabunny can decode it.
    const url = mediaUrl(opt.file_path);
    const blob = await fetch(url).then((r) => r.blob());
    const name = opt.file_path.split("/").pop() || "material";
    const file = new File([blob], name, { type: blob.type });
    const newId = `repl-${Date.now()}`;
    const asset: MediaAsset = {
      id: newId,
      name,
      type: opt.media_type,
      file,
      url: URL.createObjectURL(blob),
      thumbnailUrl: URL.createObjectURL(blob),
    } as MediaAsset;
    // Add asset then point the element at it.
    editor.media.setAssets({ assets: [...editor.media.getAssets(), asset] });
    editor.timeline.updateElements({
      updates: [{ trackId: selEl.trackId, elementId: selEl.id, updates: { mediaId: newId } as never }],
    });
    setOptions([]);
  }

  return (
    <div style={{
      position: "absolute", right: 12, top: 12, width: 240, zIndex: 50,
      background: "#1b1b1b", border: "1px solid #333", borderRadius: 8, padding: 12,
      color: "#eee", fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>换素材</div>
      <div style={{ color: "#999", fontSize: 12, marginBottom: 8, maxHeight: 48, overflow: "hidden" }}>
        {segText || "(该片段无文案)"}
      </div>
      <button onClick={fetchOptions} disabled={loading || !segText}
        style={{ width: "100%", padding: "6px 0", background: loading ? "#444" : "#2d6cdf", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", marginBottom: 8 }}>
        {loading ? "搜索中…" : "找几个候选"}
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {options.map((opt, i) => {
          const ourl = mediaUrl(opt.file_path);
          return (
            <div key={i} onClick={() => applyReplace(opt)}
              style={{ cursor: "pointer", borderRadius: 4, overflow: "hidden", border: "1px solid #444" }}>
              {opt.media_type === "image" ? (
                <img src={ourl} style={{ width: "100%", height: 64, objectFit: "cover" }} />
              ) : (
                <video src={ourl} muted style={{ width: "100%", height: 64, objectFit: "cover" }} />
              )}
            </div>
          );
        })}
      </div>

      {/* MG 动画生成 */}
      <div style={{ borderTop: "1px solid #333", marginTop: 10, paddingTop: 10 }}>
        <button onClick={makeMG} disabled={mgLoading || !segText}
          style={{ width: "100%", padding: "6px 0", background: mgLoading ? "#444" : "#7a3fb5", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          {mgLoading ? "生成 MG 中…" : "✨ 生成 MG 动画"}
        </button>
        {mgUrl && (
          <div style={{ marginTop: 8 }}>
            <iframe src={mgUrl} title="MG preview"
              style={{ width: "100%", height: 220, border: "1px solid #444", borderRadius: 4, background: "#000" }} />
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>MG 动画预览（HTML）。渲染成视频需后端 hyperframes 环境。</div>
          </div>
        )}
      </div>
    </div>
  );
}
