/**
 * Opening the cash drawer from a reprint or Retry Open needs the register PIN of the employee doing it,
 * the same as a No-Sale open (audit #48). Returns the typed PIN, or null when the prompt is cancelled.
 */
export async function askRegisterPin(promptDialog) {
  const pin = await promptDialog({
    title: "Register PIN",
    body: "Opening the cash drawer from a reprint needs your register PIN. It is recorded in the drawer audit with your name.",
    placeholder: "Your 4-digit PIN",
    confirmText: "Open drawer",
    tone: "warning",
    inputType: "password",
  });
  return pin == null ? null : String(pin).trim();
}
