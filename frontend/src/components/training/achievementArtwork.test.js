/**
 * Awards shown anywhere must use the admin-uploaded trophy picture.
 * AchievementCard used to draw only the Font Awesome icon and ignored
 * `trophy_custom_image`, so the client School "Achievements" grid showed
 * crown/medal/bolt glyphs even after an upload. These pin the fix.
 */
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import AchievementCard from "./AchievementCard";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pgi9HgAAAABJRU5ErkJggg==";
const base = {
  id: "aw1", trophy_code: "top_dog", trophy_name: "Top Dog", trophy_icon: "fa-crown",
  trophy_tier: "gold", trophy_description: "Ten training goals mastered.", awarded_at: "2026-06-23T12:00:00Z",
};
const render = (t) => renderToStaticMarkup(<AchievementCard trophy={t} testid="ach" />);

test("renders the uploaded trophy image instead of the icon glyph", () => {
  const html = render({ ...base, trophy_custom_image: PNG, trophy_image_fit: "circle", trophy_image_offset_x: 30, trophy_image_offset_y: 70 });
  expect(html).toContain(`src="${PNG}"`);
  expect(html).toContain('alt="Top Dog"');
  expect(html).toContain("object-position:30% 70%");
  expect(html).not.toContain("fa-crown");
  expect(html).toContain('data-testid="ach-artwork"');
  expect(html).not.toContain('data-testid="ach-icon"');
});

test("honours contain and freeform fit modes from the trophy settings", () => {
  expect(render({ ...base, trophy_custom_image: PNG, trophy_image_fit: "contain" })).toMatch(/w-\[88%\] h-\[88%\] object-contain/);
  expect(render({ ...base, trophy_custom_image: PNG, trophy_image_fit: "freeform" })).toMatch(/w-full h-full object-contain/);
});

test("falls back to the icon tile only when the trophy has no upload", () => {
  const html = render(base);
  expect(html).toContain("fa-crown");
  expect(html).toContain('data-testid="ach-icon"');
  expect(html).not.toContain("<img");
  expect(html).toContain("Top Dog");
  expect(html).toContain("Ten training goals mastered.");
});

test("legacy explicit props still work and every award surface passes the full row", () => {
  const html = renderToStaticMarkup(<AchievementCard icon="fa-bolt" name="Quick Learner" description="d" date="2026-06-23" />);
  expect(html).toContain("fa-bolt");
  expect(html).toContain("Quick Learner");
  const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
  for (const src of [read("..", "school", "student", "ProgressScreen.jsx"), read("..", "PortalProgress.jsx"), read("..", "OnlineSchoolDashboard.jsx")]) {
    expect(src).toMatch(/<AchievementCard key=\{t\.id\} trophy=\{t\}/);
    expect(src).not.toMatch(/<AchievementCard[^>]*icon=\{t\.trophy_icon\}/);
  }
});
