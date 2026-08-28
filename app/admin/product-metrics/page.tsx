import type { Metadata } from "next";

import ProductMetricsClient from "./product-metrics-client";


export const metadata: Metadata = {
  title: "产品指标 · MultiMix",
  description: "MultiMix 管理员产品指标",
};


export default function ProductMetricsPage() {
  return <ProductMetricsClient />;
}
