/**
 * The uploaded receipt logo used to render only in the settings preview.
 * Every real receipt renderer must draw it, and trophy rows outside the
 * trophy wall must draw uploaded artwork.
 */
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

test("shared ReceiptLogo is used by every on-screen receipt", () => {
  for (const rel of [["..", "screens", "Pos.jsx"], ["CheckoutModal.jsx"], ["TakePaymentModal.jsx"], ["PortalInvoices.jsx"], ["ReceiptSettingsPanel.jsx"]]) {
    const src = read(...rel);
    expect(src).toMatch(/import ReceiptLogo/);
    expect(src).toMatch(/<ReceiptLogo imageId=\{/);
  }
  expect(read("ReceiptSettingsPanel.jsx")).not.toMatch(/function ReceiptLogo\(/);
});

test("portal print window embeds the logo data URL", () => {
  const src = read("PortalInvoices.jsx");
  expect(src).toMatch(/fetchReceiptLogoDataUrl\(payload\.business_logo_image_id\)/);
  expect(src).toMatch(/logoSrc \? `<img src="\$\{logoSrc\}"/);
});

test("trophy ladder and activity feed render uploaded artwork through TrophyBadge", () => {
  const ladder = read("HomeworkIncentivesPanel.jsx");
  expect(ladder).toMatch(/import TrophyBadge/);
  expect((ladder.match(/t\.custom_image\s*\?\s*<TrophyBadge definition=\{t\}/g) || []).length).toBe(1);
  expect(ladder).toMatch(/t\.custom_image\s*\?\s*<span[^>]*><TrophyBadge definition=\{t\} size="sm" locked/);
  const hub = read("PortalEngagementHub.jsx");
  expect(hub).toMatch(/trophy: t,/);
  expect(hub).toMatch(/item\.trophy\.trophy_custom_image \|\| item\.trophy\.custom_image/);
  expect(hub).toMatch(/<TrophyBadge trophy=\{item\.trophy\} size="sm"\/>/);
});
