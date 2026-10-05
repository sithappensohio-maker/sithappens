/**
 * An announcement shows what its email broadcast really did, so a family that was never
 * queued is visible to staff (audit #88).
 */
import { broadcastSummary } from "./Announcements";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, formatErr: (e) => String(e) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("../components/RichTextEditor", () => () => null);

test.each([
  [{ sent: 12, queued: 0, retrying: 0, cancelled: 0, failed: 0 }, "12 emailed"],
  [{ sent: 4, queued: 8, retrying: 0, cancelled: 0, failed: 0 }, "4 emailed · 8 waiting"],
  [{ sent: 9, queued: 0, retrying: 2, cancelled: 1, failed: 3 }, "9 emailed · 2 retrying · 1 cancelled · 3 couldn't be queued"],
  [{}, "0 emailed"],
])("%j reads as %s", (status, text) => {
  expect(broadcastSummary(status)).toBe(text);
});
