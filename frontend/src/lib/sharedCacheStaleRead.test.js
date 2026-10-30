/* A dog list that was already loading when a save finished is from before the
 * save, so it must not be cached. Cached, it showed "vaccines needed" for up
 * to 20 seconds right after a client uploaded their vaccine certificate.
 * Drives the real api.js cache through a fake network adapter.
 */
import { api } from "./api";

const pending = [];
beforeEach(() => {
  pending.length = 0;
  api.defaults.adapter = (config) => new Promise((resolve) => {
    pending.push({ config, reply: (data) => resolve({ data, status: 200, statusText: "OK", headers: {}, config }) });
  });
});
const next = () => new Promise((r) => setTimeout(r, 0));

test("a read that was in flight across a save is not cached; the next read fetches fresh", async () => {
  const stale = api.get("/dogs");
  await next();
  expect(pending).toHaveLength(1);

  const save = api.post("/portal/dogs/d1/vaccine-update", {});   // the upload
  await next();
  pending[1].reply({ ok: true });
  await save;

  pending[0].reply([{ id: "d1", vaccines_pending_review: {} }]);   // answered from before the upload
  await stale;

  const fresh = api.get("/dogs");
  await next();
  expect(pending).toHaveLength(3);   // went to the server, didn't reuse the stale answer
  pending[2].reply([{ id: "d1", vaccines_pending_review: { rabies: true } }]);
  expect((await fresh).data[0].vaccines_pending_review).toEqual({ rabies: true });
});

test("an ordinary read is still cached", async () => {
  const first = api.get("/dogs", { params: { probe: "cached" } });
  await next();
  pending[pending.length - 1].reply([{ id: "d2" }]);
  await first;
  const before = pending.length;
  const second = await api.get("/dogs", { params: { probe: "cached" } });
  expect(pending.length).toBe(before);
  expect(second.data).toEqual([{ id: "d2" }]);
});
