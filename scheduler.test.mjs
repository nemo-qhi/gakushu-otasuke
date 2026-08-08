import assert from "node:assert/strict";
import test from "node:test";
import { achievementFor, elapsedMinutes, planStudy } from "../lib/scheduler.mjs";
import { sampleInput } from "../lib/sampleData.mjs";

test("keeps immutable tasks unchanged", () => {
  const result = planStudy(sampleInput);
  const locked = result.tasks.find((task) => task.id === "locked-math");

  assert.equal(locked.locked, true);
  assert.equal(locked.rangeStart, 12);
  assert.equal(locked.rangeEnd, 14);
  assert.equal(locked.status, "planned");
});

test("does not mutate scheduler input", () => {
  const before = JSON.stringify(sampleInput);
  planStudy(sampleInput);
  assert.equal(JSON.stringify(sampleInput), before);
});

test("does not create generated tasks beyond hard stop", () => {
  const result = planStudy(sampleInput);

  for (const task of result.tasks.filter((item) => !item.locked)) {
    const end = new Date(task.endAt);
    const hourMinute = `${String(end.getHours()).padStart(2, "0")}:${String(
      end.getMinutes(),
    ).padStart(2, "0")}`;
    const hardStop = task.date === "2026-08-11" ? "21:30" : "22:20";
    assert.ok(hourMinute <= hardStop, `${task.id} ends after ${hardStop}`);
  }
});

test("never duplicates material ranges", () => {
  const result = planStudy(sampleInput);
  const rangesByMaterial = new Map();

  for (const task of result.tasks) {
    const list = rangesByMaterial.get(task.materialId) ?? [];
    for (const range of list) {
      assert.equal(
        task.rangeStart < range.end && task.rangeEnd > range.start,
        false,
        `${task.materialId} range ${task.rangeStart}-${task.rangeEnd} overlaps`,
      );
    }
    list.push({ start: task.rangeStart, end: task.rangeEnd });
    rangesByMaterial.set(task.materialId, list);
  }
});

test("places mobile material into mobile blocks and desk material into desk blocks", () => {
  const result = planStudy(sampleInput);
  const mobileTask = result.tasks.find((task) => task.materialId === "english-words");
  const deskTask = result.tasks.find((task) => task.materialId === "math-probability" && !task.locked);

  assert.match(mobileTask.slotId, /commute|lunch/);
  assert.match(deskTask.slotId, /evening|weekend/);
});

test("returns infeasible warnings when capacity cannot satisfy remaining work", () => {
  const constrained = {
    ...sampleInput,
    planningDays: 1,
    scheduleTemplates: [
      {
        id: "tiny",
        weekday: 1,
        startTime: "20:00",
        endTime: "20:20",
        context: "desk",
        focusLevel: "low",
        extendable: false,
        label: "短い枠",
        active: true,
      },
    ],
    materials: [
      {
        ...sampleInput.materials[0],
        currentValue: 1,
        endValue: 60,
        deadline: sampleInput.today,
      },
    ],
    existingTasks: [],
    exceptions: [],
  };

  const result = planStudy(constrained);
  assert.equal(result.warnings.some((warning) => warning.code === "infeasible_deadline"), true);
});

test("calculates achievement from actual quantity", () => {
  const task = { minimumQty: 2, standardQty: 4, extraQty: 6 };

  assert.equal(achievementFor(1, task), "below_minimum");
  assert.equal(achievementFor(2, task), "minimum");
  assert.equal(achievementFor(4, task), "standard");
  assert.equal(achievementFor(6, task), "extra");
});

test("restores timer elapsed time from absolute timestamps", () => {
  const elapsed = elapsedMinutes({
    startedAt: "2026-08-10T10:00:00.000Z",
    now: "2026-08-10T10:45:00.000Z",
    accumulatedPauseMs: 5 * 60 * 1000,
    manualAdjustmentMs: 2 * 60 * 1000,
  });

  assert.equal(elapsed, 42);
});
