import assert from "node:assert/strict";
import test from "node:test";
import { achievementFor, elapsedMinutes, planStudy } from "../lib/scheduler.mjs";
import { sampleInput } from "../lib/sampleData.mjs";

const fixtureInput = {
  today: "2026-08-10",
  planningDays: 7,
  settings: {
    planningBufferRatio: 0.8,
    softEndTime: "21:30",
    hardStopTime: "22:20",
    nearStartLockMinutes: 30,
  },
  scheduleTemplates: [
    {
      id: "commute-am",
      weekday: 1,
      startTime: "07:20",
      endTime: "08:05",
      context: "mobile",
      focusLevel: "medium",
      extendable: false,
      label: "Morning commute",
      active: true,
    },
    {
      id: "lunch",
      weekday: 1,
      startTime: "12:30",
      endTime: "12:55",
      context: "mobile",
      focusLevel: "low",
      extendable: false,
      label: "Lunch break",
      active: true,
    },
    {
      id: "evening-desk",
      weekday: 1,
      startTime: "19:20",
      endTime: "21:40",
      context: "desk",
      focusLevel: "high",
      extendable: true,
      label: "Evening desk",
      active: true,
    },
    {
      id: "commute-am",
      weekday: 2,
      startTime: "07:20",
      endTime: "08:05",
      context: "mobile",
      focusLevel: "medium",
      extendable: false,
      label: "Morning commute",
      active: true,
    },
    {
      id: "evening-desk",
      weekday: 2,
      startTime: "19:10",
      endTime: "21:50",
      context: "desk",
      focusLevel: "high",
      extendable: true,
      label: "Evening desk",
      active: true,
    },
    {
      id: "weekend-main",
      weekday: 6,
      startTime: "10:00",
      endTime: "12:00",
      context: "desk",
      focusLevel: "high",
      extendable: false,
      label: "Weekend main",
      active: true,
    },
  ],
  exceptions: [
    {
      id: "club-overrun",
      date: "2026-08-11",
      type: "capacity_delta",
      deltaMinutes: -35,
      note: "Club overrun",
    },
    {
      id: "hard-stop",
      date: "2026-08-11",
      type: "hard_stop_override",
      endAt: "21:30",
      note: "Early hard stop",
    },
  ],
  materials: [
    {
      id: "math-probability",
      subject: "Math",
      name: "Probability proof drills",
      phase: "first-pass",
      unitType: "problem",
      startValue: 1,
      endValue: 42,
      currentValue: 12,
      deadline: "2026-08-20",
      subjectPriority: 5,
      materialPriority: 5,
      context: "desk",
      minChunk: 2,
      initialMinutesPerUnit: 18,
      estimatedMinutesPerUnit: 16,
      active: true,
    },
    {
      id: "english-words",
      subject: "English",
      name: "Vocabulary target",
      phase: "review",
      unitType: "word",
      startValue: 1,
      endValue: 900,
      currentValue: 620,
      deadline: "2026-08-31",
      subjectPriority: 4,
      materialPriority: 3,
      context: "mobile",
      minChunk: 30,
      initialMinutesPerUnit: 0.35,
      estimatedMinutesPerUnit: 0.3,
      active: true,
    },
  ],
  existingTasks: [
    {
      id: "locked-math",
      date: "2026-08-10",
      slotId: "2026-08-10:evening-desk",
      materialId: "math-probability",
      materialName: "Probability proof drills",
      subject: "Math",
      rangeStart: 12,
      rangeEnd: 14,
      unitType: "problem",
      minimumQty: 2,
      standardQty: 2,
      extraQty: 2,
      actualQty: 0,
      estimatedMinutes: 32,
      status: "planned",
      achievement: "none",
      locked: true,
      revision: 1,
      startAt: "2026-08-10T19:20:00.000Z",
      endAt: "2026-08-10T21:40:00.000Z",
    },
  ],
};

test("starts with blank user-entered material and life-time data", () => {
  assert.deepEqual(sampleInput.materials, []);
  assert.deepEqual(sampleInput.scheduleTemplates, []);
  assert.deepEqual(sampleInput.existingTasks, []);
  assert.deepEqual(sampleInput.exceptions, []);
});

test("keeps immutable tasks unchanged", () => {
  const result = planStudy(fixtureInput);
  const locked = result.tasks.find((task) => task.id === "locked-math");

  assert.equal(locked.locked, true);
  assert.equal(locked.rangeStart, 12);
  assert.equal(locked.rangeEnd, 14);
  assert.equal(locked.status, "planned");
});

test("does not mutate scheduler input", () => {
  const before = JSON.stringify(fixtureInput);
  planStudy(fixtureInput);
  assert.equal(JSON.stringify(fixtureInput), before);
});

test("does not create generated tasks beyond hard stop", () => {
  const result = planStudy(fixtureInput);

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
  const result = planStudy(fixtureInput);
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
  const result = planStudy(fixtureInput);
  const mobileTask = result.tasks.find((task) => task.materialId === "english-words");
  const deskTask = result.tasks.find((task) => task.materialId === "math-probability" && !task.locked);

  assert.match(mobileTask.slotId, /commute|lunch/);
  assert.match(deskTask.slotId, /evening|weekend/);
});

test("returns infeasible warnings when capacity cannot satisfy remaining work", () => {
  const constrained = {
    ...fixtureInput,
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
        ...fixtureInput.materials[0],
        currentValue: 1,
        endValue: 60,
        deadline: fixtureInput.today,
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
