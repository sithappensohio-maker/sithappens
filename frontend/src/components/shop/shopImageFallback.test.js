/* A product photo that the fast route refuses to serve.
 *
 * /shop/media/<id>/<size> is unauthenticated -- an <img> cannot send a bearer
 * token -- so it only serves an image while its item is publicly visible. Both
 * product editors write `publicly_visible: false` for anything kept off the
 * guest storefront, and for every Shopify listing unconditionally. The image
 * then 404s and the browser paints the alt text, which is what "changing the
 * photo didn't work" looked like: the photo had saved, its delivery had not.
 *
 * A signed-in client recovers via the authenticated route. A guest has no such
 * route and must land on the placeholder rather than a broken image.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductImage } from "./ShopPrimitives";

jest.mock("../../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));

const { api } = require("../../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const ITEM = { id: "p1", name: "Bark Hole Tag", image_id: "media-1", image_ids: ["media-1"] };

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    img: () => host.querySelector("img"),
    placeholder: () => host.querySelector("i.fa-camera"),
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

const fail = async (w) => {
  await act(async () => { w.img().dispatchEvent(new Event("error")); });
};

beforeEach(() => { api.get.mockReset(); });

describe("a signed-in client gets the photo back", () => {
  test("a 404 on the fast route is recovered from the authenticated one", async () => {
    api.get.mockResolvedValue({ data: { id: "media-1", mime: "image/png", data: DATA_URL } });
    const w = mount(<ProductImage item={ITEM} />);
    expect(w.img().getAttribute("src")).toContain("/shop/media/media-1/card");

    await fail(w);

    expect(api.get).toHaveBeenCalledWith("/shop/media/media-1");
    expect(w.img().getAttribute("src")).toBe(DATA_URL);
    // One concrete file: srcset would only confuse the browser here.
    expect(w.img().getAttribute("srcset")).toBeNull();
    w.cleanup();
  });

  test("it gives up rather than looping when the fallback also fails", async () => {
    api.get.mockResolvedValue({ data: { id: "media-1", mime: "image/png", data: DATA_URL } });
    const w = mount(<ProductImage item={ITEM} />);
    await fail(w);
    await fail(w);
    expect(w.img()).toBeNull();
    expect(w.placeholder()).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(1);
    w.cleanup();
  });

  test("an authenticated route that errors lands on the placeholder", async () => {
    api.get.mockRejectedValue(new Error("401"));
    const w = mount(<ProductImage item={ITEM} />);
    await fail(w);
    expect(w.img()).toBeNull();
    expect(w.placeholder()).toBeTruthy();
    w.cleanup();
  });

  test("a response with no image data is not rendered as a src", async () => {
    api.get.mockResolvedValue({ data: { id: "media-1", mime: "image/png" } });
    const w = mount(<ProductImage item={ITEM} />);
    await fail(w);
    expect(w.img()).toBeNull();
    w.cleanup();
  });
});

describe("a guest never reaches for a route they cannot use", () => {
  test("a failed public image goes straight to the placeholder", async () => {
    const w = mount(<ProductImage item={ITEM} isPublic />);
    expect(w.img().getAttribute("src")).toContain("/public/shop/media/");
    await fail(w);
    expect(api.get).not.toHaveBeenCalled();
    expect(w.img()).toBeNull();
    expect(w.placeholder()).toBeTruthy();
    w.cleanup();
  });
});

describe("nothing changes when there is no image", () => {
  test("an item with no photo renders the placeholder and asks for nothing", () => {
    const w = mount(<ProductImage item={{ id: "p2", name: "No photo" }} />);
    expect(w.img()).toBeNull();
    expect(w.placeholder()).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
    w.cleanup();
  });
});
