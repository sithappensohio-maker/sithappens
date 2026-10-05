import { createContext, useContext } from "react";

// The app's prompt dialog context (lib/useConfirm.jsx provides it). Kept in its own module so a screen can read it
// without importing lib/useConfirm, whose mocks in tests would otherwise hide it.
export const PromptCtx = createContext(null);

// For a screen that may render outside the app's ConfirmProvider (a drawer PIN prompt): outside the provider the
// prompt cancels, so nothing is done without the PIN, instead of throwing.
export function useOptionalPromptDialog() {
  return useContext(PromptCtx) ?? (async () => null);
}
