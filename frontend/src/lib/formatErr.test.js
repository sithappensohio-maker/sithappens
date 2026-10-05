/**
 * formatErr turns an error into a sentence for the screen. Many callers pass the whole
 * Axios error, not its detail, and the screen then showed "AxiosError: Request failed with
 * status code 404" in place of the server's message (audit #92).
 */
import { formatErr } from "./api";

test("an Axios error shows the server's message, not the Axios wording", () => {
  const err = { isAxiosError: true, message: "Request failed with status code 404",
    response: { status: 404, data: { detail: "No gift card with that code." } } };
  expect(formatErr(err)).toBe("No gift card with that code.");
});

test("an Axios error with no server message gets the generic sentence", () => {
  const networkDown = { isAxiosError: true, message: "Network Error" };
  expect(formatErr(networkDown)).toBe("Something went wrong.");
  expect(formatErr({ isAxiosError: true, response: { status: 500, data: {} } })).toBe("Something went wrong.");
});

test("the detail itself is still formatted as before", () => {
  expect(formatErr("Dog not found")).toBe("Dog not found");
  expect(formatErr(null)).toBe("Something went wrong.");
  expect(formatErr([{ msg: "Name is required" }, { msg: "Phone is required" }])).toBe("Name is required Phone is required");
});
