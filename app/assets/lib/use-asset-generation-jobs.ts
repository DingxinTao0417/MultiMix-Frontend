"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const [jobsByConversation, setJobsByConversation] = useState<Record<string, AssetGenerationJobLive>>({});
  const jobsByConversationRef = useRef(jobsByConversation);
  const inFlightRunsRef = useRef(new Set<string>());
  const refreshedRunsRef = useRef(new Set<string>());
  const onConversationRefreshedRef = useRef(onConversationRefreshed);
  const onConversationRefreshErrorRef = useRef(onConversationRefreshError);
  onConversationRefreshedRef.current = onConversationRefreshed;
  onConversationRefreshErrorRef.current = onConversationRefreshError;
  const registerJob = useCallback((
    conversationId: string,
    job: AssetGenerationJobResponse,
  ) => {
    const live = { conversationId, job, run: 0 };
    jobsByConversationRef.current = {
      ...jobsByConversationRef.current,
      [conversationId]: live,
    };
    setJobsByConversation((current) => ({
      ...current,
      [conversationId]: live,
    }));
  }, []);
  const retryJob = useCallback(async (jobId: string) => {
    if (!token) return;
    const entry = Object.values(jobsByConversationRef.current)
      .find((live) => live.job.id === jobId);
    if (!entry) return;
    const remote = await assetWorkspaceAdapter.retryGenerationJob(token, jobId);
    const nextEntry = { ...entry, job: remote, run: entry.run + 1 };
    jobsByConversationRef.current = {
      ...jobsByConversationRef.current,
      [entry.conversationId]: nextEntry,
    };
    setJobsByConversation((jobs) => ({
      ...jobs,
      [entry.conversationId]: nextEntry,
    }));
  }, [token]);
  const cancelJob = useCallback(async (jobId: string) => {
    if (!token) return;
    const entry = Object.values(jobsByConversationRef.current)
      .find((live) => live.job.id === jobId);
    if (!entry) return;
    const remote = await assetWorkspaceAdapter.cancelGenerationJob(token, jobId);
    const nextEntry = { ...entry, job: remote, run: entry.run + 1 };
    jobsByConversationRef.current = {
      ...jobsByConversationRef.current,
      [entry.conversationId]: nextEntry,
    };
    setJobsByConversation((jobs) => ({
      ...jobs,
      [entry.conversationId]: nextEntry,
    }));
  }, [token]);

  useEffect(() => {
    jobsByConversationRef.current = jobsByConversation;
  }, [jobsByConversation]);

  useEffect(() => {
    const persisted = assetGenerationJobsFromConversations(conversations);
    if (!persisted.length) return;
    setJobsByConversation((current) => {
      let changed = false;
      const next = { ...current };
      for (const entry of persisted) {
        const live = next[entry.conversationId];
        if (!live) {
          next[entry.conversationId] = { ...entry, run: 0 };
          changed = true;
          continue;
        }
        if (live.job.id !== entry.job.id) {
          next[entry.conversationId] = { ...entry, run: live.run + 1 };
          changed = true;
          continue;
        }
      }
      return changed ? next : current;
    });
  }, [conversations]);

  const pollLifecycleKey = assetGenerationPollLifecycleKey(
    Object.values(jobsByConversation),
  );
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
      const current = jobsByConversationRef.current[live.conversationId];
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
        const latest = jobsByConversationRef.current[live.conversationId];
        if (latest?.job.id !== live.job.id || latest.run !== live.run) return;
        const remoteLive = { ...latest, job: remote };
        jobsByConversationRef.current = {
          ...jobsByConversationRef.current,
          [live.conversationId]: remoteLive,
        };
        setJobsByConversation((jobs) => ({
          ...jobs,
          [live.conversationId]: remoteLive,
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
            const nextRef = { ...jobsByConversationRef.current };
            const currentRef = nextRef[live.conversationId];
            if (currentRef?.job.id === live.job.id && currentRef.run === live.run) {
              delete nextRef[live.conversationId];
              jobsByConversationRef.current = nextRef;
            }
            setJobsByConversation((jobs) => {
              const latestJob = jobs[live.conversationId];
              if (latestJob?.job.id !== live.job.id || latestJob.run !== live.run) {
                return jobs;
              }
              const next = { ...jobs };
              delete next[live.conversationId];
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

    for (const live of Object.values(jobsByConversationRef.current)) {
      if (live.job.status === "queued" || live.job.status === "running") {
        schedule(live, 200);
      }
    }
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [pollLifecycleKey, token]);

  return {
    jobsByConversation,
    registerJob,
    retryJob,
    cancelJob,
  };
}
