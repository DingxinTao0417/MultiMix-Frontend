"use client";

import { useEffect, useRef, useState } from "react";

import { trackProductEvent } from "../../../lib/product-analytics";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type {
  ProjectRequirementSnapshot,
  RequirementConversationMedia,
} from "../lib/asset-workspace-types";

function RequirementEvidenceImage({
  evidence,
  token,
}: {
  evidence: RequirementConversationMedia;
  token?: string | null;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setImageUrl(null);
    setFailed(false);
    if (!token) {
      setFailed(true);
      return undefined;
    }
    void assetWorkspaceAdapter.downloadAsset(token, evidence.assetId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidence.assetId, token]);

  return (
    <figure className="shadcn-prototype-requirement-evidence-image">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated asset bytes are exposed as a short-lived object URL
        <img
          src={imageUrl}
          alt="对话中引用的图片证据"
          loading="lazy"
          onError={() => {
            setImageUrl(null);
            setFailed(true);
          }}
        />
      ) : (
        <div role="status" className={failed ? "is-failed" : undefined}>
          {failed ? "图片证据暂时无法显示" : "正在载入图片证据…"}
        </div>
      )}
      <figcaption>
        <strong>图片证据</strong>
        {evidence.anchor ? <span>{evidence.anchor}</span> : null}
        {evidence.quote ? <q>{evidence.quote}</q> : null}
      </figcaption>
    </figure>
  );
}

export function RequirementEvidenceMedia({
  media,
  token,
}: {
  media: RequirementConversationMedia[];
  token?: string | null;
}) {
  if (!media.length) return null;
  return (
    <div className="shadcn-prototype-requirement-evidence-media" aria-label="图片证据">
      {media.map((evidence, index) => (
        <RequirementEvidenceImage
          key={`${evidence.assetId}:${evidence.anchor}:${evidence.quote}:${index}`}
          evidence={evidence}
          token={token}
        />
      ))}
    </div>
  );
}

export default function RequirementUnderstandingTurn({
  snapshot,
  token,
}: {
  snapshot: ProjectRequirementSnapshot;
  token?: string | null;
}) {
  const viewedSnapshotRef = useRef("");

  useEffect(() => {
    const key = `${snapshot.id}:${snapshot.version}`;
    if (!snapshot.payload || viewedSnapshotRef.current === key) return;
    viewedSnapshotRef.current = key;
    void trackProductEvent(token, {
      eventName: "requirement_summary_viewed",
      conversationId: snapshot.conversationId,
      properties: {
        snapshot_version: snapshot.version,
        requirement_status: snapshot.status,
        source_count: snapshot.payload.sourceAssetIds.length,
      },
    });
    const hasBlockingConflict = snapshot.payload.conflicts.some((conflict) => (
      conflict.status === "unresolved" && conflict.severity === "blocking"
    ));
    if (snapshot.status === "ready" && !hasBlockingConflict) {
      void trackProductEvent(token, {
        eventName: "requirement_confirmed_first_pass",
        conversationId: snapshot.conversationId,
        properties: { snapshot_version: snapshot.version },
      });
    }
    if (snapshot.triggerKind === "conflict_resolved") {
      void trackProductEvent(token, {
        eventName: "requirement_conflict_resolved",
        conversationId: snapshot.conversationId,
        properties: { snapshot_version: snapshot.version },
      });
    }
  }, [snapshot, token]);

  if (!snapshot.conversationText.trim()) return null;

  return (
    <div className="shadcn-prototype-message-group">
      <article className="assistant" aria-label="Agent 对项目需求的理解">
        <p className="shadcn-prototype-requirement-turn-text">
          {snapshot.conversationText}
        </p>
        <RequirementEvidenceMedia media={snapshot.conversationMedia ?? []} token={token} />
      </article>
    </div>
  );
}
