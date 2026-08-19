// Whole-app operational gap-closure — source-level wiring guards.
// Full behavior is covered by backend tests + Claude browser QA; these pins
// keep the frontend entry points from silently reverting to decorative UI.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const login = read("..", "screens", "Login.jsx");
const guestAuth = read("GuestAuthModal.jsx");
const auth = read("..", "lib", "auth.js");
const settings = read("..", "screens", "Settings.jsx");
const pos = read("..", "screens", "Pos.jsx");
const shopRefund = read("ShopRefundModal.jsx");
const portal = read("..", "screens", "Portal.jsx");
const agreements = read("PortalAgreements.jsx");
const intake = read("IntakePortalSection.jsx");
const intakeAdmin = read("..", "screens", "IntakeForms.jsx");
const pending = read("PendingActionsPanel.jsx");

test("MFA login challenge never treats password login as a complete session", () => {
  expect(auth).toMatch(/if \(data\.mfa_required\)/);
  expect(auth).toMatch(/\/auth\/mfa\/verify-login/);
  expect(login).toMatch(/data-testid="login-mfa-input"/);
  expect(guestAuth).toMatch(/data-testid="guest-auth-mfa"/);
});

test("Settings exposes free authenticator MFA with setup, enable and disable endpoints", () => {
  expect(settings).toMatch(/data-testid="mfa-settings"/);
  expect(settings).toMatch(/\/auth\/mfa\/setup/);
  expect(settings).toMatch(/\/auth\/mfa\/enable/);
  expect(settings).toMatch(/\/auth\/mfa\/disable/);
  expect(settings).toMatch(/Free authenticator-app protection/);
});

test("versioned service and program agreements are editable and client-visible", () => {
  expect(settings).toMatch(/AgreementTemplatesPanel/);
  expect(settings).toMatch(/\/admin\/agreement-templates/);
  expect(portal).toMatch(/<PortalAgreements/);
  expect(agreements).toMatch(/\/portal\/agreements/);
  expect(agreements).toMatch(/\/sign`/);
});

test("Online Payments routes shop-order refunds through the line-aware refund modal", () => {
  expect(pos).toMatch(/import ShopRefundModal/);
  expect(pos).toMatch(/setRefundingShopPayment/);
  expect(pos).toMatch(/refund-shop-order-/);
  expect(shopRefund).toMatch(/\/shop-orders\/\$\{payment\.shop_order_id\}\/stripe-refund/);
  expect(shopRefund).toMatch(/restock_products/);
  expect(shopRefund).toMatch(/unused/);
});

test("client intake file fields perform a real upload and admin can download the result", () => {
  expect(intake).toMatch(/IntakeFileUpload/);
  expect(intake).toMatch(/\/portal\/intake\/submissions\/\$\{submissionId\}\/files\/\$\{f\.id\}/);
  expect(intake).toMatch(/maximum 10 MB/);
  expect(intakeAdmin).toMatch(/downloadIntakeFile/);
  expect(intakeAdmin).toMatch(/\/files\/\$\{fileRef\.file_id\}\/download/);
  expect(intakeAdmin).not.toMatch(/File uploads coming soon/i);
});

test("overdue medication Action Required entries deep-link to the Care Board", () => {
  expect(pending).toMatch(/overdue_medication/);
  expect(pending).toMatch(/Open Care Board/);
  expect(pending).toMatch(/overdue/);
});
