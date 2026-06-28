import { useState } from "react";
import { defaultSubtitleStyle, setSubtitleStyle, type SubtitleStyle } from "./buildProject";

interface Props {
  // Called after style changes so the parent can rebuild the editor project.
  onChange: (style: SubtitleStyle) => void;
}

const FONT_OPTIONS = [
  { label: "无衬线", value: "sans-serif" },
  { label: "衬线", value: "serif" },
  { label: "黑体", value: '"Heiti SC", "Microsoft YaHei", sans-serif' },
  { label: "宋体", value: '"Songti SC", "SimSun", serif' },
  { label: "圆体", value: '"Yuanti SC", "PingFang SC", sans-serif' },
];

// Subtitle style controls (font / color / background / size / position).
export function SubtitleStylePanel({ onChange }: Props) {
  const [style, setStyle] = useState<SubtitleStyle>({ ...defaultSubtitleStyle });

  function update(patch: Partial<SubtitleStyle>) {
    const next = { ...style, ...patch };
    setStyle(next);
    setSubtitleStyle(next);
    onChange(next);
  }

  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
  const label: React.CSSProperties = { fontSize: 12, color: "#aaa", width: 56, flexShrink: 0 };

  return (
    <div style={{ padding: 12, background: "#1b1b1b", border: "1px solid #333", borderRadius: 8, fontSize: 13, color: "#eee", minWidth: 240 }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>字幕样式</div>

      <div style={row}>
        <span style={label}>字体</span>
        <select value={style.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })}
          style={{ flex: 1, padding: 4, background: "#222", color: "#eee", border: "1px solid #444", borderRadius: 4 }}>
          {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      <div style={row}>
        <span style={label}>颜色</span>
        <input type="color" value={style.color.slice(0, 7)} onChange={(e) => update({ color: e.target.value })}
          style={{ width: 40, height: 26, background: "none", border: "1px solid #444", borderRadius: 4, cursor: "pointer" }} />
        <span style={{ fontSize: 12, color: "#888" }}>{style.color}</span>
      </div>

      <div style={row}>
        <span style={label}>背景</span>
        <input type="checkbox" checked={style.bgEnabled} onChange={(e) => update({ bgEnabled: e.target.checked })} />
        {style.bgEnabled && (
          <input type="color" value={style.bgColor.slice(0, 7)} onChange={(e) => update({ bgColor: e.target.value + "aa" })}
            style={{ width: 40, height: 26, background: "none", border: "1px solid #444", borderRadius: 4, cursor: "pointer" }} />
        )}
      </div>

      <div style={row}>
        <span style={label}>大小</span>
        <input type="range" min={0.5} max={2} step={0.1} value={style.sizeScale}
          onChange={(e) => update({ sizeScale: parseFloat(e.target.value) })} style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888", width: 30 }}>{style.sizeScale.toFixed(1)}x</span>
      </div>

      <div style={row}>
        <span style={label}>每行字</span>
        <input type="range" min={8} max={24} step={1} value={style.maxLineChars}
          onChange={(e) => update({ maxLineChars: parseInt(e.target.value) })} style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888", width: 30 }}>{style.maxLineChars}</span>
      </div>

      <div style={row}>
        <span style={label}>位置</span>
        <input type="range" min={0} max={0.42} step={0.02} value={style.bottomOffset}
          onChange={(e) => update({ bottomOffset: parseFloat(e.target.value) })} style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888", width: 30 }}>{Math.round(style.bottomOffset * 100)}</span>
      </div>
    </div>
  );
}
