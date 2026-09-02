/**
 * How to Use content: both role guides render, every quick jump lands on a
 * real section, section colors map to a real accent, and the copy matches
 * the app as it is now (no Dashboard/Pipeline/Homework-era navigation).
 */
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import Tutorials from "./Tutorials";

const src = fs.readFileSync(path.join(__dirname, "Tutorials.jsx"), "utf8");

const sectionIds = (roleMarker) => {
  const block = src.split(roleMarker)[1].split("];")[0];
  return [...block.matchAll(/^\s{4}id: "([a-z-]+)",/gm)].map((m) => m[1]);
};
const quickTargets = (marker) => {
  const block = src.split(marker)[1].split("];")[0];
  return [...block.matchAll(/target: "([a-z-]+)"/g)].map((m) => m[1]);
};

test("admin and client guides render", () => {
  const admin = renderToStaticMarkup(<Tutorials role="admin" />);
  const client = renderToStaticMarkup(<Tutorials role="client" />);
  expect(admin).toContain('data-role="admin"');
  expect(client).toContain('data-role="client"');
  expect(admin).toMatch(/Start on Today/);
  expect(admin).toMatch(/Register Hub/);
  expect(admin).toMatch(/School HQ/);
  expect(admin).toMatch(/Tax Center/);
  expect(client).toMatch(/Online School/);
  expect(client).toMatch(/Practice Coach/);
});

test("every quick jump targets a real section", () => {
  const adminIds = sectionIds("const ADMIN_SECTIONS = [");
  const clientIds = sectionIds("const CLIENT_SECTIONS = [");
  for (const t of quickTargets("const ADMIN_QUICK_ACTIONS = [")) expect(adminIds).toContain(t);
  for (const t of quickTargets("const CLIENT_QUICK_ACTIONS = [")) expect(clientIds).toContain(t);
  expect(clientIds).toContain("online-school");
  expect(adminIds).toContain("training-school");
  expect(adminIds).toContain("shop-manager");
});

test("section colors all map to a real accent", () => {
  const colors = [...src.matchAll(/^\s{4}color: "([^"]+)",/gm)].map((m) => m[1]);
  expect(colors.length).toBeGreaterThan(15);
  for (const c of colors) expect(c).toMatch(/text-sh(Accent|Primary|Secondary)/);
});

test("no stale navigation in the guide", () => {
  const dataOnly = src.split("export default function Tutorials")[0];
  expect(dataOnly).not.toMatch(/Sidebar → Dashboard/);
  expect(dataOnly).not.toMatch(/Sidebar → Pipeline/);
  expect(dataOnly).not.toMatch(/Sidebar → Homework/);
  expect(dataOnly).not.toMatch(/Manage Products/);
  expect(dataOnly).not.toMatch(/Operations \/ Clients \/ Business \/ Team \/ System/);
  expect(dataOnly).toMatch(/Home, Book, School, Shop, and More/);
  expect(dataOnly).toMatch(/Daily Work \/ Schedule \/ Care \/ Training \/ Shop \/ Money \/ Communication \/ Administration/);
});
