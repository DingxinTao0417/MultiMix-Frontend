"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

function MarkdownProductDocument({ markdown }: { markdown: string }) {
  return (
    <article className="shadcn-prototype-copy-document shadcn-prototype-markdown shadcn-prototype-stage-scroll-surface">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}

export default memo(MarkdownProductDocument);
