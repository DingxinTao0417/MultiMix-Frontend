import { describe, expect, it } from "vitest";
import { resolveSuggestionClickIntent } from "../lib/suggestion-actions";

describe("conversation suggestion actions", () => {
  it("submits executable suggestion chips with the backend utterance", () => {
    expect(resolveSuggestionClickIntent({
      label: "确认生成",
      utterance: "确认",
      actionType: "submit_message",
      enabled: true
    })).toEqual({
      disabled: false,
      hidden: false,
      mode: "submit_message",
      utterance: "确认"
    });
  });

  it("keeps a source choice bound to the server resolution and asset ids", () => {
    expect(resolveSuggestionClickIntent({
      label: "施工花絮 B · install-b.mp4 · video",
      utterance: "使用「施工花絮 B」继续",
      actionType: "select_source",
      enabled: true,
      targetAssetId: 202,
      sourceResolutionId: "source-resolution-abc",
    })).toEqual({
      disabled: false,
      hidden: false,
      mode: "select_source",
      utterance: "使用「施工花絮 B」继续",
      sourceResolutionSelection: {
        resolutionId: "source-resolution-abc",
        assetId: 202,
      },
    });
  });

  it("disables a source choice when its stable identity is incomplete", () => {
    expect(resolveSuggestionClickIntent({
      label: "施工花絮",
      utterance: "使用「施工花絮」继续",
      actionType: "select_source",
      enabled: true,
    }).disabled).toBe(true);
  });

  it("keeps composer-fill suggestions editable", () => {
    expect(resolveSuggestionClickIntent({
      label: "生成视频方案",
      utterance: "生成视频方案",
      actionType: "fill_composer",
      enabled: true
    })).toEqual({
      disabled: false,
      hidden: false,
      mode: "fill_composer",
      utterance: "生成视频方案"
    });
  });

  it("keeps open-panel suggestions out of conversation chips", () => {
    expect(resolveSuggestionClickIntent({
      label: "打开剪辑器",
      utterance: "打开剪辑器",
      actionType: "open_panel",
      enabled: true
    })).toEqual({
      disabled: false,
      hidden: true,
      mode: "open_panel",
      utterance: "打开剪辑器"
    });
  });

  it("hides legacy open-editor text suggestions", () => {
    expect(resolveSuggestionClickIntent({
      label: "打开剪辑器",
      utterance: "打开剪辑器",
      enabled: true
    })).toEqual({
      disabled: false,
      hidden: true,
      mode: "fill_composer",
      utterance: "打开剪辑器"
    });
  });

  it("does not submit disabled or empty suggestions", () => {
    expect(resolveSuggestionClickIntent({
      label: "确认生成",
      utterance: "确认",
      actionType: "submit_message",
      enabled: false
    }).disabled).toBe(true);
    expect(resolveSuggestionClickIntent({
      label: "",
      utterance: "",
      actionType: "submit_message",
      enabled: true
    }).disabled).toBe(true);
  });
});
