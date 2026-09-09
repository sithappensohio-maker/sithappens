/**
 * @jest-environment jsdom
 */
// The Client hub shows lifetime visits from the award engine's own count.
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VisitsCard } from "./ClientHub";

const src = fs.readFileSync(path.join(__dirname, "ClientHub.jsx"), "utf8");

test("the hub asks the server for the count when the overview opens (never counts bookings itself)", () => {
  expect(src).toMatch(/api\.get\(`\/clients\/\$\{client\.id\}\/visits`\)/);
  expect(src).toMatch(/<VisitsCard visits=\{visits\} \/>/);
  expect(src).not.toMatch(/bookings\.filter|status === "completed"/);
});

test("card copy: count, last visit, tier held, distance to the next tier, per-dog split", () => {
  const html = renderToStaticMarkup(React.createElement(VisitsCard, { visits: {
    visits: 11, last_visit: "2026-08-20",
    held: { code: "client_regular", name: "Regular", threshold: 10 },
    next: { code: "client_loyal", name: "Loyal Pack Member", threshold: 50, remaining: 39 },
    per_dog: [{ dog_id: "1", dog_name: "Rex", visits: 7 }, { dog_id: "2", dog_name: "Bea", visits: 4 }],
  } }));
  expect(html).toMatch(/data-testid="hub-visits-count">11</);
  expect(html).toMatch(/Last visit Aug 20, 2026/);
  expect(html).toMatch(/Regular/);
  expect(html).toMatch(/39 more to/);
  expect(html).toMatch(/Loyal Pack Member/);
  expect(html).toMatch(/Rex · 7/);
  expect(html).toMatch(/Bea · 4/);
});

test("a brand-new client reads honestly", () => {
  const html = renderToStaticMarkup(React.createElement(VisitsCard, { visits: { visits: 0, last_visit: null, held: null, next: { name: "Regular", threshold: 10, remaining: 10 }, per_dog: [] } }));
  expect(html).toMatch(/No visit award yet/);
  expect(html).toMatch(/10 more to/);
  expect(html).not.toMatch(/hub-visits-dogs/);
  expect(renderToStaticMarkup(React.createElement(VisitsCard, { visits: null }))).toMatch(/Counting visits/);
  expect(renderToStaticMarkup(React.createElement(VisitsCard, { visits: false }))).toBe("");
});
