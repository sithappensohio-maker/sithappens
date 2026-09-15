/**
 * @jest-environment jsdom
 */
// Training Experience Clarity Pass — Stage 5: the client Coach destination
// (formerly labelled Feedback; route unchanged). Real renders of the screen
// with server-shaped records, plus the pure feed/attention helpers and the
// navigation/route compatibility guards.
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FeedbackScreen from "./FeedbackScreen";
import { NAV_ITEMS } from "./SchoolNav";
import { parseSchoolPath, schoolPathFor } from "../../../lib/studentSchool";
import { coachAttentionItems, coachFeed, coachEmptyState } from "../../../lib/coachFeed";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const screenSrc = read("FeedbackScreen.jsx");
const appSrc = read("..", "..", "..", "screens", "SchoolApp.jsx");
const navSrc = read("SchoolNav.jsx");

const NOW = new Date().toISOString();
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const home = (over = {}) => ({
  delivery_mode: "in_person", dog: { id: "dog-a", name: "Lexi" }, program: { name: "Foundations" },
  current_lesson: { id: "l5", name: "Place With Distractions" },
  current_action: { type: "lesson", label: "Review your current lesson" },
  checkpoint_status: null, active_practice: [], ...over,
});
const recap = (over = {}) => ({ session_id: "s1", date: ago(1), trainer_name: "Garrett", lesson_name: "Place With Distractions",
  what_went_well: "Lexi stayed on Place for 30 seconds with movement around the room.", needs_work: "Doorway distractions.",
  next_lesson_focus: "Add duration at the door.", trainer_feedback: "Really nice session.", practice_assigned: ["Place With Duration"], ...over });
const graded = (over = {}) => ({ id: "cp1", status: "graded", outcome: "advance", lesson_name: "Public Access Checkpoint", graded_at: ago(2),
  trainer_name: "Garrett", trainer_feedback: "Clean and calm.", handler_overall: 4, dog_overall: 4, rubric_snapshot: {}, ...over });
const support = (over = {}) => ({ threads: [], practice_questions: [], practice_reviews: [], unanswered_count: 0, unread_replies: 0, ...over });
const render = (props) => renderToStaticMarkup(React.createElement(FeedbackScreen, { enrollmentId: "se-1", ...props }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const RAW = /\b(prescribe_practice|trainer_assist_recommended|looks_good|keep_practicing|trainer_attention|needs_redo|awaiting_review|last_message_role|session_note)\b/;

test("the client navigation reads Today · Course · Practice · Progress · Coach, on the same route key", () => {
  expect(NAV_ITEMS.map((n) => n.label)).toEqual(["Today", "Course", "Practice", "Progress", "Coach"]);
  expect(NAV_ITEMS.map((n) => n.view)).toEqual(["today", "course", "practice", "progress", "feedback"]);
  expect(navSrc).not.toMatch(/label: "Feedback"/);
});

test("old Feedback routes and deep links still reach Coach; /school/coach is an alias", () => {
  expect(parseSchoolPath("/school/feedback").view).toBe("feedback");
  expect(parseSchoolPath("/school/coach").view).toBe("feedback");
  expect(schoolPathFor("feedback")).toBe("/school/feedback");
  expect(schoolPathFor("coach")).toBe("/school/feedback");
  // The shell still mounts the same screen for the "feedback" view and passes it the selected enrollment's home.
  expect(appSrc).toMatch(/parsed\.view === "feedback"/);
  expect(appSrc).toMatch(/<FeedbackScreen enrollmentId=\{selectedId\} home=\{home\}/);
  // No backend or component renames just to match the label.
  expect(screenSrc).toMatch(/checkpoint-history/);
  expect(screenSrc).toMatch(/\/support`/);
  expect(screenSrc).toMatch(/lesson-history/);
});

test("a recent session recap reads as the trainer talking, with the full recap one tap away", () => {
  const html = render({ home: home(), initialData: { history: [], support: support(), recaps: [recap()] } });
  const t = text(html);
  expect(t).toMatch(/Coach/);
  expect(t).toMatch(/Recent from your trainer/);
  expect(t).toMatch(/Session recap Place With Distractions with Garrett/);
  expect(t).toMatch(/Went well · Lexi stayed on Place for 30 seconds/);
  expect(t).toMatch(/Keep working on · Doorway distractions\./);
  expect(t).toMatch(/View full recap/);
  expect(html).not.toMatch(/coach-attention/); // informational, never "needs attention"
  expect(t).not.toMatch(RAW);
});

test("Practice reviews: approved, needs another try (action), and still waiting are distinct and never raw", () => {
  const tracker = { id: "hw-t", title: "Door Manners", school_lesson_name: "Door Manners", daily_tracker: true, daily_progress: [
    { day_number: 1, status: "approved", log: { reviewed_by: "Garrett", reviewed_at: ago(3), review_note: "Nice improvement." } },
    { day_number: 2, status: "needs_redo", log: { reviewed_by: "Garrett", reviewed_at: ago(1), review_note: "Slow down before opening the door and reward the pause." } },
    { day_number: 3, status: "submitted", log: { logged_at: NOW } },
  ] };
  const sup = support({ practice_reviews: [{ id: "r1", homework_id: "hw-x", practice_title: "Loose Leash Walking", review_status: "looks_good", review_note: "Keep your turns slower.", reviewed_at: ago(4), trainer_name: "Garrett" }] });
  const h = home({ active_practice: [tracker, { id: "hw-x", title: "Loose Leash Walking" }] });
  const html = render({ home: h, initialData: { history: [], support: sup, recaps: [] }, onOpenPractice: () => {} });
  const t = text(html);
  // Needs your attention: the redo, with the trainer note and the canonical Practice CTA.
  expect(html).toMatch(/data-testid="coach-attention-practice_redo"/);
  expect(t).toMatch(/Try this Practice again Your trainer reviewed Door Manners and wants another round\./);
  expect(t).toMatch(/Trainer note: Slow down before opening the door/);
  expect(html).toMatch(/data-testid="coach-attention-cta-practice_redo"/);
  // Feed: approved, try again, waiting, and the section-log review.
  expect(t).toMatch(/Approved/);
  expect(t).toMatch(/Try this again/);
  expect(t).toMatch(/Waiting for trainer review Your trainer hasn't looked at this yet\. Nothing to do until they do\./);
  expect(t).not.toMatch(/Waiting for trainer review Your trainer reviewed/);
  expect(t).toMatch(/Looks Good/);
  expect(t).toMatch(/Keep your turns slower\./);
  expect(t).not.toMatch(RAW);
  // The approved row does not ask for action.
  const attention = coachAttentionItems({ home: h, support: sup, history: [] });
  expect(attention.map((a) => a.kind)).toEqual(["practice_redo"]);
  expect(attention[0].cta).toEqual({ label: "Start Practice", run: "open_practice", homeworkId: "hw-t" });
});

test("checkpoint results: passed, more Practice needed (action routes to the engine), and waiting for review", () => {
  const passed = render({ home: home(), initialData: { history: [graded()], support: support(), recaps: [] } });
  expect(text(passed)).toMatch(/Checkpoint result Public Access Checkpoint with Garrett .* Passed Your trainer approved this checkpoint\./);
  expect(text(passed)).toMatch(/See results/);
  expect(passed).not.toMatch(/coach-attention/);

  const more = graded({ id: "cp2", outcome: "prescribe_practice", trainer_feedback: "Two areas need work.", prescription: { practice_sessions_remaining: 2, action: "repeat_current_recipe" } });
  const hMore = home({ checkpoint_status: { ...more }, current_action: { type: "remediation", label: "Complete remediation" } });
  const html = render({ home: hMore, initialData: { history: [more], support: support(), recaps: [] }, onPrimaryAction: () => {} });
  const t = text(html);
  expect(html).toMatch(/data-testid="coach-attention-checkpoint_more"/);
  expect(t).toMatch(/Checkpoint needs more work 2 more Practice sessions before you can try again\./);
  expect(t).toMatch(/More Practice needed/);
  expect(t).toMatch(/See what to work on/);
  const items = coachAttentionItems({ home: hMore, support: support(), history: [more] });
  expect(items[0].cta).toEqual({ label: "Start Practice", run: "primary_action" });
  // Without a remediation action, the CTA opens the result instead of inventing progression.
  const noAction = coachAttentionItems({ home: home({ checkpoint_status: { ...more } }), support: support(), history: [more] });
  expect(noAction[0].cta.run).toBe("expand");

  const waiting = render({ home: home({ checkpoint_status: { id: "cp3", status: "awaiting_review", submitted_at: NOW } }), initialData: { history: [], support: support(), recaps: [] } });
  expect(text(waiting)).toMatch(/Waiting for review Your trainer needs to review this before you continue\./);
  expect(waiting).not.toMatch(/coach-attention/);
  expect(text(waiting)).not.toMatch(RAW);
});

test("a trainer reply asks for a response and opens the real conversation; a client question waits quietly", () => {
  const thread = { id: "t1", subject: "Visitors this week", status: "open", last_message_role: "trainer", last_message_at: ago(1), unread_client: true,
    messages: [{ id: "m1", sender_role: "client", sender_name: "Lexi's owner", body: "She barked at the mail carrier." }, { id: "m2", sender_role: "trainer", sender_name: "Garrett", body: "How did she do around visitors this week?" }] };
  const sup = support({ threads: [thread], practice_questions: [{ id: "q1", lesson_name: "Recall", text: "Should I use a long line?", asked_at: ago(2), answer: null }] });
  const html = render({ home: home(), initialData: { history: [], support: sup, recaps: [] } });
  const t = text(html);
  expect(html).toMatch(/data-testid="coach-attention-trainer_message"/);
  expect(t).toMatch(/Your trainer replied “How did she do around visitors this week\?”/);
  expect(t).toMatch(/Respond/);
  expect(t).toMatch(/Your question Recall .* You asked: “Should I use a long line\?” Waiting on a reply — nothing else to do/);
  // Replies use the existing thread endpoints — no second messaging system.
  expect(screenSrc).toMatch(/api\.post\(`\/me\/messages\/\$\{thread\.id\}\/reply`/);
  expect(screenSrc).toMatch(/api\.post\(`\/me\/messages\/\$\{thread\.id\}\/read`/);
  // A thread the client answered last never asks the client for action.
  const mine = coachAttentionItems({ home: home(), support: support({ threads: [{ ...thread, last_message_role: "client", unread_client: false }] }) });
  expect(mine).toEqual([]);
  // The backend stores the replier's own role (admin replies are common), so an
  // admin reply asks for a response just like a trainer's.
  const admin = coachAttentionItems({ home: home(), support: support({ threads: [{ ...thread, last_message_role: "admin", messages: [thread.messages[0], { ...thread.messages[1], sender_role: "admin" }] }] }) });
  expect(admin.map((i) => [i.kind, i.cta.label])).toEqual([["trainer_message", "Respond"]]);
  const resolved = coachAttentionItems({ home: home(), support: support({ threads: [{ ...thread, status: "resolved" }] }) });
  expect(resolved).toEqual([]);
});

test("empty Coach is truthful per delivery mode and never an empty shell", () => {
  const led = render({ home: home({ delivery_mode: "in_person" }), initialData: { history: [], support: support(), recaps: [] } });
  expect(led).toMatch(/native-feedback-empty/);
  expect(text(led)).toMatch(/Nothing here yet After your trainer completes a lesson/);
  const online = render({ home: home({ delivery_mode: "online" }), initialData: { history: [], support: support(), recaps: [] } });
  const onlineEmpty = text(online.slice(online.indexOf('data-testid="native-feedback-empty"')));
  expect(onlineEmpty).toMatch(/Practice reviews, checkpoint results, and trainer replies will appear here/);
  expect(onlineEmpty).not.toMatch(/lesson recaps|in-person/i);
  expect(coachEmptyState({ delivery_mode: "hybrid" }).body).toMatch(/lesson recaps/);
});

test("Coach is scoped to the selected enrollment — switching dogs or programs swaps everything", () => {
  const a = text(render({ home: home(), initialData: { history: [graded()], support: support(), recaps: [recap()] } }));
  const b = text(render({ home: home({ dog: { id: "dog-b", name: "Max" }, delivery_mode: "online" }), initialData: { history: [], support: support({ practice_reviews: [{ id: "r9", homework_id: "hw-9", practice_title: "Heel", review_status: "keep_practicing", review_note: "Shorter sessions.", reviewed_at: NOW }] }), recaps: [] } }));
  expect(a).toMatch(/Place With Distractions/); expect(a).toMatch(/Public Access Checkpoint/); expect(a).not.toMatch(/Heel|Shorter sessions/);
  expect(b).toMatch(/Heel/); expect(b).toMatch(/Keep Practicing/); expect(b).not.toMatch(/Place With Distractions|Public Access Checkpoint|Garrett/);
  // The live screen reloads per enrollment id and clears every record first.
  expect(screenSrc).toMatch(/setHistory\(null\); setSupport\(null\); setRecaps\(\[\]\); setFilter\("all"\); setShown\(PAGE\); setExpanded\(\{\}\);/);
  expect(screenSrc).toMatch(/\[load, enrollmentId\]/);
});

test("private trainer fields and raw enums never render, even if present on a record", () => {
  const html = render({ home: home(), initialData: { history: [graded({ session_note: "PRIVATE staff only", grading_plan: "PRIVATE plan" })], support: support(), recaps: [recap({ session_note: "PRIVATE session note" })] } });
  expect(html).not.toMatch(/PRIVATE/);
  expect(text(html)).not.toMatch(RAW);
  for (const bad of ["session_note", "internal_notes", "grading_plan"]) expect(screenSrc).not.toContain(bad);
});

test("the feed pages: eight at a time, newest first, with View older", () => {
  const recaps = Array.from({ length: 10 }, (_, i) => recap({ session_id: `s${i}`, date: ago(i + 1), lesson_name: `Lesson ${i}` }));
  const html = render({ home: home(), initialData: { history: [], support: support(), recaps } });
  expect((html.match(/data-kind="recap"/g) || []).length).toBe(8);
  expect(text(html)).toMatch(/View older/);
  expect(text(html).indexOf("Lesson 0")).toBeLessThan(text(html).indexOf("Lesson 7"));
  const feed = coachFeed({ recaps, history: [], support: support(), home: home() });
  expect(feed[0].title).toBe("Lesson 0");
});

test("filters are real tabs and only offer categories that have content", () => {
  const html = render({ home: home(), initialData: { history: [graded()], support: support(), recaps: [recap()] } });
  expect(html).toMatch(/role="tablist"/);
  expect(html).toMatch(/aria-selected="false"[^>]*data-testid="coach-filter-recap"|data-testid="coach-filter-recap"[^>]*aria-selected="false"/);
  expect(html).toMatch(/data-testid="coach-filter-checkpoint"/);
  expect(html).not.toMatch(/data-testid="coach-filter-practice"/);
  expect(html).toMatch(/data-testid="coach-filter-all"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-testid="coach-filter-all"/);
});

test("Today keeps its own recap (LAST step) — Coach is the history home, not a dependency", () => {
  const homeSrc = read("StudentHome.jsx");
  expect(homeSrc).toMatch(/today-recap-disclosure/);
  expect(homeSrc).not.toMatch(/checkpoint-history|lesson-history/);
});
