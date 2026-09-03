/**
 * @jest-environment jsdom
 */
import { enterImmersive, leaveImmersive, immersiveCount, isImmersiveActive, subscribeImmersive, _resetImmersiveForTests } from "./immersiveWorkflow";

beforeEach(() => _resetImmersiveForTests());

test("holders are counted, nested workflows release in any order, never below zero", () => {
  expect(isImmersiveActive()).toBe(false);
  const releaseA = enterImmersive();
  const releaseB = enterImmersive();
  expect(immersiveCount()).toBe(2);
  releaseA();
  expect(isImmersiveActive()).toBe(true);
  releaseB();
  expect(isImmersiveActive()).toBe(false);
  leaveImmersive();
  expect(immersiveCount()).toBe(0);
});

test("subscribers are told on every change and can unsubscribe", () => {
  const seen = [];
  const off = subscribeImmersive(() => seen.push(immersiveCount()));
  const release = enterImmersive();
  release();
  off();
  enterImmersive();
  expect(seen).toEqual([1, 0]);
});

test("suppression never touches the install prompt's dismissal storage", () => {
  localStorage.removeItem("sh_install_dismissed_at");
  const release = enterImmersive();
  release();
  expect(localStorage.getItem("sh_install_dismissed_at")).toBeNull();
});
