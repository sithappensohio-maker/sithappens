/**
 * RichTextEditor's toolbar — every existing consumer mocks this component
 * away entirely (`jest.mock(".../RichTextEditor", () => () => null)`), so
 * none of its own behavior has ever been directly tested. Added here
 * alongside the new Heading/Color controls (owner: product descriptions
 * needed "formatting and headers and color and text options") so those
 * two new controls — and the existing ones, while mounted anyway — are
 * proven against the real component, not assumed.
 *
 * document.execCommand does not exist in jsdom, so it's mocked to record
 * what this component asks the browser to do; a real browser then does
 * the actual formatting, same as it already does for Bold/Italic today.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../lib/useConfirm";
import RichTextEditor from "./RichTextEditor";

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root, execCommandCalls;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  execCommandCalls = [];
  document.execCommand = jest.fn((cmd, ui, arg) => { execCommandCalls.push([cmd, arg]); return true; });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
  delete document.execCommand;
});

const mount = (props = {}) => {
  act(() => {
    root = createRoot(container);
    root.render(
      <ConfirmProvider>
        <RichTextEditor value="" onChange={() => {}} testId="rte" {...props} />
      </ConfirmProvider>,
    );
  });
};

const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("the incoming value is sanitized into the editor body", () => {
  mount({ value: '<p>Hello</p><script>alert(1)</script>' });
  expect(q("rte").innerHTML).toBe("<p>Hello</p>");
});

test("picking a Heading calls formatBlock with h2, and a Subheading with h3", () => {
  mount();
  const select = q("rte-heading");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => { setter.call(select, "h2"); select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(execCommandCalls).toContainEqual(["formatBlock", "h2"]);

  act(() => { setter.call(select, "h3"); select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(execCommandCalls).toContainEqual(["formatBlock", "h3"]);
});

test("picking Paragraph calls formatBlock with div, not the literal word \"p\" or \"paragraph\"", () => {
  // execCommand("formatBlock", false, "p") is inconsistent across browsers
  // for "back to a plain paragraph" — div is the one that reliably works.
  mount();
  const select = q("rte-heading");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => { setter.call(select, "p"); select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(execCommandCalls).toContainEqual(["formatBlock", "div"]);
});

test("choosing a text color calls foreColor with the real hex value", () => {
  mount();
  const colorInput = q("rte-color");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(colorInput, "#ff0000"); colorInput.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(execCommandCalls).toContainEqual(["foreColor", "#ff0000"]);
});

test("Bold, Italic and Underline still call their own execCommand", () => {
  mount();
  act(() => { container.querySelector('[title="Bold"]').click(); });
  act(() => { container.querySelector('[title="Italic"]').click(); });
  act(() => { container.querySelector('[title="Underline"]').click(); });
  expect(execCommandCalls.map((c) => c[0])).toEqual(["bold", "italic", "underline"]);
});

test("every formatting action re-emits sanitized HTML via onChange", () => {
  const onChange = jest.fn();
  mount({ onChange, value: "<p>Start</p>" });
  act(() => { container.querySelector('[title="Bold"]').click(); });
  expect(onChange).toHaveBeenCalledWith("<p>Start</p>");
});
