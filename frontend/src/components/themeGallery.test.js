/**
 * Theme Gallery (Settings → Brand & Appearance) — mounted, not source-pinned,
 * following registerClientPicker.test.js / employeePortalWalkInAndRegister.test.js's
 * established mock-api/mock-theme/mock-sonner/mock-useConfirm mount pattern.
 *
 * Covers: ACTIVE badge placement, "Use This Theme" activation + reloadBranding,
 * built-in/active cards hiding Delete, Delete calling the DELETE endpoint,
 * "+ New Theme" posting all 25 theme fields (not just a name), and importing
 * a JSON file via the hidden file input.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ThemeGallery from "./ThemeGallery";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));

const mockReloadBranding = jest.fn();
const mockBranding = { active_theme_id: "classic-id" };
jest.mock("../lib/theme", () => ({
  useTheme: () => ({ branding: mockBranding, reloadBranding: mockReloadBranding }),
}));

const { api } = require("../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

// All 25 THEME_FIELD_KEYS the backend contract defines, given realistic values
// so every preset below is a full, valid theme object (plus id/name/built_in).
const fullFields = (overrides = {}) => ({
  brand_primary: "#8cc63f", brand_accent: "#00a9e0", brand_warning: "#f26522",
  brand_font_family: "Inter", brand_footer_text: "Sit Happens", brand_footer_url: "",
  interface_style: "standard",
  theme_bg_base: "#060c2e", theme_bg_panel: "#0c143e", theme_bg_header: "#03061a", theme_bg_hover: "#1a225a",
  theme_text_primary: "#e2e8f0", theme_text_muted: "#94a3b8", theme_text_display: "#ffffff",
  theme_btn_primary_bg: "#8cc63f", theme_btn_primary_fg: "#03061a",
  theme_btn_secondary_border: "#1a225a", theme_btn_secondary_fg: "#e2e8f0",
  theme_btn_danger_bg: "#ef4444", theme_btn_danger_fg: "#ffffff",
  theme_input_bg: "#060c2e", theme_input_border: "#1a225a", theme_input_focus: "#8cc63f",
  theme_calendar_active: "#8cc63f", theme_table_hover: "#1a225a", theme_row_border: "#1a225a",
  ...overrides,
});
const THEME_FIELD_KEYS = Object.keys(fullFields());

const CLASSIC = { id: "classic-id", name: "Classic", built_in: true, created_at: "t", updated_at: "t", ...fullFields() };
const HALLOWEEN = { id: "halloween-id", name: "Halloween", built_in: true, created_at: "t", updated_at: "t", ...fullFields({ brand_primary: "#ff7518", theme_bg_base: "#0a0a0a" }) };
const CHRISTMAS = { id: "christmas-id", name: "Christmas", built_in: true, created_at: "t", updated_at: "t", ...fullFields({ brand_primary: "#c41e3a", brand_accent: "#0f8a5f" }) };
const CUSTOM = { id: "custom-id", name: "My Brand", built_in: false, created_at: "t", updated_at: "t", ...fullFields({ brand_primary: "#9333ea" }) };
const THEMES = [CLASSIC, HALLOWEEN, CHRISTMAS, CUSTOM];

let container, root;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockReloadBranding.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation((path) => {
    if (path === "/settings/themes") return Promise.resolve({ data: THEMES });
    return Promise.resolve({ data: [] });
  });
  api.post.mockImplementation((path) => {
    if (path === "/settings/themes") return Promise.resolve({ data: { id: "new-id", name: "New Theme", built_in: false, ...fullFields() } });
    return Promise.resolve({ data: {} });
  });
  api.delete.mockResolvedValue({ data: {} });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mount() {
  root = createRoot(container);
  await act(async () => { root.render(<ThemeGallery />); });
  await flush();
}
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); await flush(); };
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("only the active theme's card shows the ACTIVE badge", async () => {
  await mount();
  expect(q("theme-active-badge-classic-id")).not.toBeNull();
  expect(q("theme-active-badge-halloween-id")).toBeNull();
  expect(q("theme-active-badge-christmas-id")).toBeNull();
  expect(q("theme-active-badge-custom-id")).toBeNull();
});

test("clicking Use This Theme on a non-active card activates it and reloads branding", async () => {
  await mount();
  expect(q("theme-activate-classic-id")).toBeNull(); // already active — no activate button
  await click(q("theme-activate-halloween-id"));

  const activateCall = api.post.mock.calls.find(([path]) => path === "/settings/themes/halloween-id/activate");
  expect(activateCall).toBeTruthy();
  expect(mockReloadBranding).toHaveBeenCalled();
});

test("built-in cards show no Delete button; the custom, non-active theme's card does", async () => {
  await mount();
  expect(q("theme-delete-classic-id")).toBeNull();
  expect(q("theme-delete-halloween-id")).toBeNull();
  expect(q("theme-delete-christmas-id")).toBeNull();
  expect(q("theme-delete-custom-id")).not.toBeNull();
});

test("clicking Delete on the custom theme calls the delete endpoint", async () => {
  await mount();
  await click(q("theme-delete-custom-id"));
  expect(api.delete).toHaveBeenCalledWith("/settings/themes/custom-id");
});

test("+ New Theme posts all 25 theme field keys copied from the active theme, not just a name", async () => {
  await mount();
  await click(q("theme-new-btn"));
  await setValue(q("theme-new-inline-name"), "My New Look");
  await click(q("theme-new-inline-confirm"));

  const createCall = api.post.mock.calls.find(([path]) => path === "/settings/themes");
  expect(createCall).toBeTruthy();
  const body = createCall[1];
  expect(body.name).toBe("My New Look");
  THEME_FIELD_KEYS.forEach((k) => {
    expect(body[k]).toBe(CLASSIC[k]); // cloned from the currently-active theme
  });

  // "work from a template" → immediately activated too.
  const activateCall = api.post.mock.calls.find(([path]) => path === "/settings/themes/new-id/activate");
  expect(activateCall).toBeTruthy();
  expect(mockReloadBranding).toHaveBeenCalled();
});

test("importing a theme file posts the parsed body to the create endpoint", async () => {
  await mount();
  const imported = { name: "Imported", ...fullFields({ brand_primary: "#111111" }) };
  const file = new File([JSON.stringify(imported)], "theme.json", { type: "application/json" });
  const input = q("theme-import-input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  await flush();

  const createCall = api.post.mock.calls.find(([path]) => path === "/settings/themes");
  expect(createCall).toBeTruthy();
  expect(createCall[1]).toEqual(imported);
  // Imported themes are reviewed in the gallery, never auto-activated.
  expect(api.post.mock.calls.some(([path]) => path === "/settings/themes/new-id/activate")).toBe(false);
});
