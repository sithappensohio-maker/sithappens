/**
 * A check-in refused for a vaccine is still readable after the API layer flattens the
 * message for legacy renderers, so staff get the "Check in anyway" confirm (audit #41).
 * Runs the backend's 409 through the real response interceptors.
 */
import { api, vaccineWarningOf } from "./api";

const flatten = async (err) => {
  for (const h of api.interceptors.response.handlers) {
    if (!h?.rejected) continue;
    try { await h.rejected(err); } catch (e) { err = e; }
  }
  return err;
};

const WARNING = { code: "vaccine_warning", message: "Rex's rabies shot expired on 2025-01-01.", dog_name: "Rex" };

test("the vaccine warning survives the message being flattened", async () => {
  const err = await flatten({ response: { status: 409, data: { detail: WARNING } } });
  expect(err.response.data.detail).toBe(WARNING.message);
  expect(vaccineWarningOf(err)).toEqual(WARNING);
});

test("any other refusal is not a vaccine warning", async () => {
  const err = await flatten({ response: { status: 409, data: { detail: { code: "capacity_full", message: "Full." } } } });
  expect(vaccineWarningOf(err)).toBeNull();
  expect(vaccineWarningOf({ response: { data: { detail: "Dog not found" } } })).toBeNull();
});
