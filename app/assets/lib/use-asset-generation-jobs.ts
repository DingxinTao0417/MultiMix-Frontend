"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { assetWorkspaceAdapter } from "./asset-workspace-adapter";
import {
  assetGenerationJobsFromConversations,
  assetGenerationPollLifecycleKey,
} from "./asset-generation-poller";
import type { Conversation } from "./asset-workspace-shared";

export type AssetGenerationJobLive = {
  conversationId: string;
  job: AssetGenerationJobResponse;
  run: number;
};

type UseAssetGenerationJobsArgs = {
  token: string | null;
  conversations: Conversation[];
  onConversationRefreshed: (conversation: Conversation) => void;
  onConversationRefreshError: () => void;
};

export function useAssetGenerationJobs(
  args: UseAssetGenerationJobsArgs,
) {
  const {
    conversations,
    onConversationRefreshed,
    onConversationRefreshError,
    token,
  } = args;
  const [jobsById, setJobsById] = useState<Record<string, AssetGenerationJobLive>>({});
  const jobsByIdRef = useRef(jobsById);
  const conversationsRef = useRef(conversations);
  const inFlightRunsRef = useRef(new Set<string>());
  const refreshedRunsRef = useRef(new Set<string>());
  const onConversationRefreshedRef = useRef(onConversationRefreshed);
  const onConversationRefreshErrorRef = useRef(onConversationRefreshError);
  conversationsRef.current = conversations;
  onConversationRefreshedRef.current = onConversationRefreshed;
  onConversationRefreshErrorRef.current = onConversationRefreshError;
  const registerJob = useCallback((
    conversationId: string,
    job: AssetGenerationJobResponse,
  ) => {
    const live = { conversationId, job, run: 0 };
    jobsByIdRef.current = {
      ...jobsByIdRef.current,
      [job.id]: live,
    };
    setJobsById((current) => ({
      ...current,
      [job.id]: live,
    }));
  }, []);
  const retryJob = useCallback(async (jobId: string, fallbackConversationId?: string) => {
    if (!token) return;
    const liveEntry = Object.values(jobsByIdRef.current)
      .find((live) => live.job.id === jobId)
    const persistedEntry = assetGenerationJobsFromConversations(conversationsRef.current)
      .find((persisted) => persisted.job.id === jobId);
    const conversationId = liveEntry?.conversationId
      ?? persistedEntry?.conversationId
      ?? fallbackConversationId;
    if (!conversationId) {
      throw new Error("未找到可重试的内容生成任务，请刷新对话后重试。");
    }
    const remote = await assetWorkspaceAdapter.retryGenerationJob(token, jobId);
    const nextEntry = {
      conversationId,
      job: remote,
      run: (liveEntry?.run ?? 0) + 1,
    };
    jobsByIdRef.current = {
      ...jobsByIdRef.current,
      [remote.id]: nextEntry,
    };
    setJobsById((jobs) => ({
      ...jobs,
      [remote.id]: nextEntry,
    }));
  }, [token]);
  const cancelJob = useCallback(async (jobId: string) => {
    if (!token) return;
    const entry = Object.values(jobsByIdRef.current)
      .find((live) => live.job.id === jobId);
    if (!entry) return;
    const remote = await assetWorkspaceAdapter.cancelGenerationJob(token, jobId);
    const nextEntry = { ...entry, job: remote, run: entry.run + 1 };
    jobsByIdRef.current = {
      ...jobsByIdRef.current,
      [remote.id]: nextEntry,
    };
    setJobsById((jobs) => ({
      ...jobs,
      [remote.id]: nextEntry,
    }));
  }, [token]);

  useEffect(() => {
    jobsByIdRef.current = jobsById;
  }, [jobsById]);

  useEffect(() => {
    const persisted = assetGenerationJobsFromConversations(conversations);
    if (!persisted.length) return;
    setJobsById((current) => {
      let changed = false;
      const next = { ...current };
      for (const entry of persisted) {
        const live = next[entry.job.id];
        if (!live) {
          next[entry.job.id] = { ...entry, run: 0 };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [conversations]);

  const pollLifecycleKey = assetGenerationPollLifecycleKey(Object.values(jobsById));
  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled() || !pollLifecycleKey) return;
    const authToken = token;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    function schedule(live: AssetGenerationJobLive, delay: number) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void poll(live);
      }, delay);
      timers.add(timer);
    }

    async function poll(live: AssetGenerationJobLive) {
      const identity = `${live.job.id}::${live.run}`;
      const current = jobsByIdRef.current[live.job.id];
      if (
        cancelled
        || current?.job.id !== live.job.id
        || current.run !== live.run
        || inFlightRunsRef.current.has(identity)
      ) return;
      inFlightRunsRef.current.add(identity);
      try {
        const remote = await assetWorkspaceAdapter.getGenerationJob(authToken, live.job.id);
        if (cancelled) return;
        const latest = jobsByIdRef.current[live.job.id];
        if (latest?.job.id !== live.job.id || latest.run !== live.run) return;
        const remoteLive = { ...latest, job: remote };
        jobsByIdRef.current = {
          ...jobsByIdRef.current,
          [live.job.id]: remoteLive,
        };
        setJobsById((jobs) => ({
          ...jobs,
          [live.job.id]: remoteLive,
        }));
        if (remote.status === "completed") {
          if (refreshedRunsRef.current.has(identity)) return;
          refreshedRunsRef.current.add(identity);
          try {
            const detail = await assetWorkspaceAdapter.loadConversationDetail(
              authToken,
              live.conversationId,
            );
            if (cancelled) return;
            onConversationRefreshedRef.current(detail);
            const nextRef = { ...jobsByIdRef.current };
            const currentRef = nextRef[live.job.id];
            if (currentRef?.job.id === live.job.id && currentRef.run === live.run) {
              delete nextRef[live.job.id];
              jobsByIdRef.current = nextRef;
            }
            setJobsById((jobs) => {
              const latestJob = jobs[live.job.id];
              if (latestJob?.job.id !== live.job.id || latestJob.run !== live.run) {
                return jobs;
              }
              const next = { ...jobs };
              delete next[live.job.id];
              return next;
            });
          } catch {
            refreshedRunsRef.current.delete(identity);
            onConversationRefreshErrorRef.current();
          }
          return;
        }
        if (remote.status === "queued" || remote.status === "running") {
          schedule({ ...live, job: remote }, 2500);
        }
      } catch {
        if (!cancelled) schedule(live, 4000);
      } finally {
        inFlightRunsRef.current.delete(identity);
      }
    }

    for (const live of Object.values(jobsByIdRef.current)) {
      if (live.job.status === "queued" || live.job.status === "running") {
        schedule(live, 200);
      }
    }
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [pollLifecycleKey, token]);

  const jobsByConversation = useMemo(() => {
    const latest: Record<string, AssetGenerationJobLive> = {};
    for (const live of Object.values(jobsById)) latest[live.conversationId] = live;
    return latest;
  }, [jobsById]);
  const jobsForConversation = useCallback(
    (conversationId: string) => Object.values(jobsById).filter((live) => live.conversationId === conversationId),
    [jobsById],
  );

  return {
    jobsByConversation,
    jobsForConversation,
    registerJob,
    retryJob,
    cancelJob,
  };
}
