import { describe, expect, it } from "vitest";
import {
  confirmationMessagePresentation,
  mergeVisibleConversationMessages,
  optimisticVideoProjectSteps,
  shouldRenderMessageBody,
} from "../lib/conversation-execution-presentation";

describe("confirmation message presentation", () => {
  it("builds the complete optimistic video-project skeleton", () => {
    expect(optimisticVideoProjectSteps()).toEqual([
      { key: "create_job", label: "创建视频工程任务", status: "run" },
      { key: "prepare_scenes", label: "读取已确认方案并准备分镜", status: "wait" },
      { key: "prepare_media", label: "匹配分镜素材并准备配音、字幕", status: "wait" },
      { key: "build_project", label: "组装可编辑视频工程", status: "wait" },
    ]);
  });

  it("hides the persisted confirmation command", () => {
    expect(confirmationMessagePresentation("user", {
      confirmation_idempotency_key: "confirm-1",
      video_workflow_stage: "director_script_confirmed",
    })).toBe("hidden_confirmation");
  });

  it("turns the queued assistant message into an execution anchor", () => {
    expect(confirmationMessagePresentation("assistant", {
      confirmation_idempotency_key: "confirm-1",
      video_workflow_stage: "video_project_queued",
      job_public_id: "video-job-1",
    })).toBe("execution_anchor");
  });

  it("keeps ordinary messages visible", () => {
    expect(confirmationMessagePresentation("assistant", {})).toBe("standard");
  });

  it("adds only an execution anchor for optimistic confirmation", () => {
    const result = mergeVisibleConversationMessages(
      [{ role: "assistant", text: "请确认", presentation: "standard" }],
      {
        userText: "确认，生成视频工程",
        assistantText: "已确认，正在创建视频工程任务。",
        status: "pending",
        presentation: "execution_anchor",
        runSteps: [{ key: "create_job", label: "创建视频工程任务", status: "run" }],
      },
    );

    expect(result).toHaveLength(2);
    expect(result.at(-1)).toMatchObject({
      role: "assistant",
      presentation: "execution_anchor",
    });
    expect(result.some((message) => message.role === "user" && message.text.includes("确认"))).toBe(false);
  });

  it("removes persisted hidden confirmation messages", () => {
    const result = mergeVisibleConversationMessages([
      { role: "user", text: "确认", presentation: "hidden_confirmation" },
      { role: "assistant", text: "已进入队列", presentation: "execution_anchor" },
    ], null);

    expect(result.map((message) => message.role)).toEqual(["assistant"]);
  });

  it("keeps user and assistant messages for ordinary optimistic instructions", () => {
    const result = mergeVisibleConversationMessages([], {
      userText: "把第二段改短一点",
      assistantText: "",
      status: "pending",
    });

    expect(result).toEqual([
      { role: "user", text: "把第二段改短一点" },
      {
        role: "assistant",
        text: "",
        pending: true,
        localState: undefined,
        presentation: "standard",
        runSteps: undefined,
      },
    ]);
  });

  it("hides normal execution-anchor copy", () => {
    expect(shouldRenderMessageBody({
      role: "assistant",
      text: "已确认，正在创建视频工程任务。",
      presentation: "execution_anchor",
      pending: true,
    })).toBe(false);
  });

  it.each(["stopped", "unsubmitted"] as const)(
    "shows %s execution-anchor copy",
    (localState) => {
      expect(shouldRenderMessageBody({
        role: "assistant",
        text: "任务未完成。",
        presentation: "execution_anchor",
        localState,
      })).toBe(true);
    },
  );

  it("hides failed execution-anchor copy because the execution steps already show failure", () => {
    expect(shouldRenderMessageBody({
      role: "assistant",
      text: "发送失败，请稍后重试。",
      presentation: "execution_anchor",
      localState: "failed",
    })).toBe(false);
  });
});
