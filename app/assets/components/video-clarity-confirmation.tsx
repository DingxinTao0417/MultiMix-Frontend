import type { ClarityConfirmation } from "../lib/video-clarity-types";
import { CLARITY_RISK_COPY, CLARITY_RESEARCH_RISK_COPY, clarityConfirmationValid, clarityMoney } from "../lib/video-clarity-presentation";
import styles from "./video-clarity.module.css";

export default function VideoClarityConfirmation({ confirmation }: { confirmation?: ClarityConfirmation | null }) {
  return <section className={styles.card} aria-label="画质增强风险与费用">
    <p>{confirmation?.funding_purpose === "research" ? CLARITY_RESEARCH_RISK_COPY : CLARITY_RISK_COPY}</p>
    <p>保留原片。候选复检通过后，仍需另行确认采用。</p>
    {clarityConfirmationValid(confirmation) ? <><p>{confirmation.funding_purpose === "research" ? "预估项目研发支出 " : "预估处理费 "}{clarityMoney(confirmation.currency, confirmation.estimated_minor)}；本次上限 {clarityMoney(confirmation.currency, confirmation.max_minor)}。</p>
      {confirmation.funding_purpose === "research" && confirmation.research_model_budget ? <p>模型复检研发预算 {clarityMoney("CNY", confirmation.research_model_budget.max_minor)}；最多{confirmation.research_model_budget.max_calls}次，单次上限 {clarityMoney("CNY", confirmation.research_model_budget.call_max_minor)}。与处理支出分开核对。</p> : null}</>
      : <p role="alert">风险告知或报价已失效，请在对话中重新准备增强方案。</p>}
  </section>;
}
