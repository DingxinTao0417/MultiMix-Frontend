const LONG_FORM_REQUIREMENT_SUGGESTIONS = [
  ["找出值得发布的片段", "找出这段内容中值得发布的片段"],
  ["按主题或观点筛选", "按我指定的主题或观点筛选这段内容"],
  ["先梳理内容结构", "先梳理这段内容的章节和结构，再让我决定下一步"],
] as const;

export default function LongFormComposerPrompt({
  onFill,
}: {
  onFill: (value: string) => void;
}) {
  return (
    <div className="shadcn-prototype-long-form-prompt" aria-label="长视频处理需求">
      <p>你想怎么处理这段内容？</p>
      <div>
        {LONG_FORM_REQUIREMENT_SUGGESTIONS.map(([label, value]) => (
          <button type="button" key={label} onClick={() => onFill(value)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
