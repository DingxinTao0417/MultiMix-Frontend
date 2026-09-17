// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
  authChange: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
}));

vi.mock("../../../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn((callback) => {
        mocks.authChange = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      }),
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  },
}));

import ResetPasswordPage from "../page";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authChange = null;
    window.history.replaceState({}, "", "/auth/reset-password?code=recovery-code");
    mocks.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("requires a recovery session and matching passwords before updating", async () => {
    render(<ResetPasswordPage />);

    expect(screen.getByText("正在验证重置链接...")).toBeVisible();
    await act(async () => {
      mocks.authChange?.("PASSWORD_RECOVERY", { access_token: "token" } as Session);
    });

    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("再次输入新密码"), { target: { value: "different-password" } });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致。");
    expect(mocks.updateUser).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("再次输入新密码"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password" }));
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await screen.findByText("密码已更新")).toBeVisible();
  });
});
