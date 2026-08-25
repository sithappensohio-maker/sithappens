import fs from "fs";
import path from "path";

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const clientToday = read("ClientTodayPanel.jsx");
const dogRow = read("TrainingDogRow.jsx");
const polish = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "trainerDashboardPolish.js"), "utf8");

test("Client Hub loads and renders durable Board & Train daily updates", () => {
  expect(clientToday).toMatch(/\/portal\/board-train\/updates/);
  expect(clientToday).toMatch(/Board & Train Updates/);
  expect(clientToday).toMatch(/biggest_win/);
  expect(clientToday).toMatch(/biggest_challenge/);
  expect(clientToday).toMatch(/tomorrow_focus/);
  expect(clientToday).toMatch(/Previous updates/);
});

test("Training Hub visibly identifies Board & Train day, slot and closeout", () => {
  expect(dogRow).toMatch(/trainer_delivery_kind/);
  expect(dogRow).toMatch(/trainer_delivery_day/);
  expect(dogRow).toMatch(/trainer_delivery_slot/);
  expect(dogRow).toMatch(/Closeout required/);
});

test("Needs Attention includes overdue Board & Train work and missing closeout", () => {
  expect(polish).toMatch(/board_train_am_training_overdue/);
  expect(polish).toMatch(/board_train_pm_training_overdue/);
  expect(polish).toMatch(/daily closeout still required/);
});
