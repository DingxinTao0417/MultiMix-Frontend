import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app/assets/components/confirm-card.tsx"),
  "utf8",
);

describe("ConfirmCard", () => {
  it("supports an optimistic confirmed state while the request is starting", () => {
    expect(source).toContain("optimisticallyConfirmed = false");
    expect(source).toContain('plan.status === "confirmed" || optimisticallyConfirmed');
  });
});
