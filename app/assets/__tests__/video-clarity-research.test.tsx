// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import VideoClarityConfirmation from "../components/video-clarity-confirmation";
import ClarityProcessingNotice from "../components/clarity-processing-notice";
import { clarityConfirmationValid, parseClarityResult } from "../lib/video-clarity-presentation";
vi.mock("../../../lib/api", () => ({ getVideoClarityCandidates: vi.fn() }));
afterEach(cleanup);

it("saved research review remains visible while expenses await reconciliation", () => {
  const parsed=parseClarityResult({...result,quality_status:"failed",intervals:[{
    ...result.intervals[0],status:"quality_failed",candidate_available:true,
    review:{status:"quality_failed",coverage_complete:true,technical_passed:true,improvement:"none"}
  }]});
  if (!parsed) throw new Error("projection missing");
  render(<ClarityProcessingNotice result={parsed} />);
  expect(screen.getByText("复检结果已保存，研发费用待核账")).toBeVisible();
  expect(screen.getByText(/项目研发支出：待核对/)).toBeVisible();
  expect(screen.getByText(/复检未通过，保留原版/)).toBeVisible();
  expect(screen.queryByText(/费用0/)).toBeNull();
});

it("research confirmation states project expense and does not promise customer collection", () => {
  render(<VideoClarityConfirmation confirmation={{ risk_copy_version:"video-clarity-risk:v1",
    funding_purpose:"research",research_model_budget:{currency:"CNY",max_minor:200,call_max_minor:100,max_calls:2},currency:"USD",estimated_minor:100,max_minor:200,expires_at:"2099-01-01T00:00:00Z" }} />);
  expect(screen.getByText(/不向测试用户收费/)).toBeVisible();
  expect(screen.getByText(/预估项目研发支出/)).toBeVisible();
  expect(screen.queryByText(/已发生的处理费用仍会收取/)).toBeNull();
});

it("unknown funding is not accepted as a valid confirmation", () => {
  expect(clarityConfirmationValid({risk_copy_version:"video-clarity-risk:v1",funding_purpose:"unknown",
    currency:"USD",estimated_minor:100,max_minor:200,expires_at:"2099-01-01T00:00:00Z"})).toBe(false);
});

const result = { version:"video-clarity-result:v1",funding_purpose:"research",job_id:"test",asset_id:7,
  status:"blocked",quality_status:"unknown",stage:"fee_reconciliation_required",adopted:false,retryable:false,
  intervals:[{interval_id:"one",scene_id:"s1",start_seconds:0,end_seconds:2,status:"submission_unknown",qualified:false,
    adopted:false,candidate_available:false}],processing_cost:{currency:"USD",incurred_minor:null,known_incurred_minor:0,unknown_executions:1},
  payment:{status:"unverified",settled_minor:null},delivery:{confirmed_at:"2026-10-11T00:00:00Z",target_seconds:600,
    elapsed_seconds:10,result_ready_at:null,target_met:null},needs_reconciliation:true };

it("research unknown expenses remain unknown and never display a paid claim", () => {
  const parsed=parseClarityResult(result);
  expect(parsed && "funding_purpose" in parsed && parsed.funding_purpose).toBe("research");
  if (!parsed) throw new Error("projection missing");
  render(<ClarityProcessingNotice result={parsed} />);
  expect(screen.getByText(/项目研发支出：待核对/)).toBeVisible();
  expect(screen.getByText(/不向测试用户收款/)).toBeVisible();
  expect(screen.queryByText(/已发生处理费：/)).toBeNull();
});

it("research cannot carry a customer settlement or unknown funding purpose", () => {
  expect(parseClarityResult({...result,payment:{status:"receipts_available",settled_minor:100}})).toBeNull();
  expect(parseClarityResult({...result,funding_purpose:"unknown"})).toBeNull();
});


it("model expenses are separately displayed in CNY and incomplete usage stays unknown", () => {
  const parsed=parseClarityResult({...result,research_model_cost:{currency:"CNY",incurred_minor:null,known_incurred_minor:7,unknown_executions:1}});
  if (!parsed) throw new Error("projection missing");
  render(<ClarityProcessingNotice result={parsed} />);
  expect(screen.getByText(/模型研发支出：待核对.*CNY 0.07/)).toBeVisible();
  expect(screen.getByText(/项目研发支出：待核对.*USD/)).toBeVisible();
});

it("model expenses cannot silently change currency or carry inconsistent known totals", () => {
  const cost={currency:"USD",incurred_minor:7,known_incurred_minor:7,unknown_executions:0};
  expect(parseClarityResult({...result,research_model_cost:cost})).toBeNull();
  expect(parseClarityResult({...result,research_model_cost:{...cost,currency:"CNY",incurred_minor:8}})).toBeNull();
  expect(parseClarityResult({...result,funding_purpose:"commercial",research_model_cost:{...cost,currency:"CNY"}})).toBeNull();
});


it("research confirmation requires and shows the separately funded model limits", () => {
  const base={risk_copy_version:"video-clarity-risk:v1",funding_purpose:"research" as const,currency:"USD",
    estimated_minor:100,max_minor:200,expires_at:"2099-01-01T00:00:00Z"};
  expect(clarityConfirmationValid(base)).toBe(false);
  const budget={currency:"CNY",max_minor:200,call_max_minor:100,max_calls:2};
  expect(clarityConfirmationValid({...base,research_model_budget:{...budget,max_minor:100}})).toBe(false);
  render(<VideoClarityConfirmation confirmation={{...base,research_model_budget:budget}} />);
  expect(screen.getByText(/模型复检研发预算 CNY 2.00.*最多2次.*单次上限 CNY 1.00/)).toBeVisible();
});
