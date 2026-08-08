const DAY_MS = 24 * 60 * 60 * 1000;

export function planStudy(input) {
  const settings = {
    today: input.today,
    planningDays: input.planningDays ?? 7,
    planningBufferRatio: input.settings?.planningBufferRatio ?? 0.8,
    softEndTime: input.settings?.softEndTime ?? "21:30",
    hardStopTime: input.settings?.hardStopTime ?? "22:30",
    nearStartLockMinutes: input.settings?.nearStartLockMinutes ?? 30,
  };

  const dates = Array.from({ length: settings.planningDays }, (_, index) =>
    addDays(settings.today, index),
  );
  const materials = input.materials.filter((material) => material.active !== false);
  const existingTasks = input.existingTasks ?? [];
  const immutableTasks = existingTasks.filter(isImmutableTask);
  const mutableExistingTasks = existingTasks.filter((task) => !isImmutableTask(task));
  const warnings = [];
  const usedRanges = buildUsedRanges(immutableTasks);
  const materialCursors = new Map(
    materials.map((material) => [material.id, material.currentValue]),
  );

  const blocksByDate = new Map();
  for (const date of dates) {
    const blocks = createAvailableBlocks({
      date,
      templates: input.scheduleTemplates,
      exceptions: input.exceptions ?? [],
      hardStopTime: hardStopForDate(date, settings, input.exceptions ?? []),
    });
    blocksByDate.set(date, reserveImmutableCapacity(blocks, immutableTasks, date));
  }

  for (const material of materials) {
    const capacity = totalCompatibleCapacityUntil(material, dates, blocksByDate);
    const required = Math.max(0, material.endValue - material.currentValue) *
      minutesPerUnit(material) * 0.65;
    if (required > capacity) {
      warnings.push({
        code: "infeasible_deadline",
        materialId: material.id,
        message: `${material.name} is unlikely to fit before ${material.deadline}.`,
      });
    }
  }

  const generated = [];
  const taskIndex = new Map();
  const phaseOrder = ["minimum", "standard", "extra"];

  for (const date of dates) {
    for (const phase of phaseOrder) {
      const blocks = blocksByDate.get(date) ?? [];
      const touchedToday = new Set();
      for (const block of blocks) {
        const capacityLimit = phase === "extra"
          ? block.minutes
          : Math.floor(block.minutes * settings.planningBufferRatio);

        while (block.usedMinutes < capacityLimit) {
          const candidate = chooseMaterial({
            materials,
            materialCursors,
            usedRanges,
            date,
            block,
            phase,
            touchedToday,
          });

          if (!candidate) break;

          const qty = Math.min(candidate.minChunk, candidate.endValue - candidate.cursor);
          const minutes = qty * minutesPerUnit(candidate);
          if (minutes <= 0 || block.usedMinutes + minutes > block.minutes) break;

          const range = nextRange(candidate, qty, materialCursors, usedRanges);
          if (!range) {
            touchedToday.add(`${phase}:${candidate.id}`);
            continue;
          }

          addPlannedTask({
            generated,
            taskIndex,
            material: candidate,
            date,
            block,
            phase,
            range,
            qty,
            minutes,
          });
          block.usedMinutes += minutes;
          materialCursors.set(candidate.id, range.end);
          addUsedRange(usedRanges, candidate.id, range.start, range.end);
          touchedToday.add(`${phase}:${candidate.id}`);
        }
      }
    }
  }

  const tasks = [...immutableTasks, ...generated].sort(compareTasks);
  const changedTaskCount = countChangedTasks(mutableExistingTasks, generated);

  return {
    tasks,
    changedTaskCount,
    warnings,
    schedulerRevision: stableRevision(tasks, warnings),
    summary: summarize(tasks, warnings, changedTaskCount),
  };
}

export function createAvailableBlocks({
  date,
  templates,
  exceptions = [],
  hardStopTime,
}) {
  const weekday = weekdayOf(date);
  let blocks = templates
    .filter((template) => template.active !== false && template.weekday === weekday)
    .map((template) => {
      const startAt = timestamp(date, template.startTime);
      const endAt = Math.min(timestamp(date, template.endTime), timestamp(date, hardStopTime));
      return {
        id: `${date}:${template.id}`,
        templateId: template.id,
        date,
        label: template.label,
        startAt,
        endAt,
        context: template.context,
        focusLevel: template.focusLevel,
        extendable: Boolean(template.extendable),
        locked: Boolean(template.locked),
        minutes: minutesBetween(startAt, endAt),
        usedMinutes: 0,
      };
    })
    .filter((block) => block.minutes > 0);

  for (const exception of exceptions.filter((item) => item.date === date)) {
    if (exception.type === "unavailable_all_day") {
      blocks = [];
    }

    if (exception.type === "unavailable_until") {
      const until = timestamp(date, exception.endAt ?? exception.startAt);
      blocks = blocks
        .map((block) => ({
          ...block,
          startAt: Math.max(block.startAt, until),
          minutes: minutesBetween(Math.max(block.startAt, until), block.endAt),
        }))
        .filter((block) => block.minutes > 0);
    }

    if (exception.type === "replace_block") {
      const startAt = timestamp(date, exception.startAt);
      const endAt = Math.min(timestamp(date, exception.endAt), timestamp(date, hardStopTime));
      if (endAt > startAt) {
        blocks.push({
          id: `${date}:exception:${exception.id}`,
          templateId: exception.id,
          date,
          label: exception.note ?? "Exception block",
          startAt,
          endAt,
          context: exception.context ?? "either",
          focusLevel: exception.focusLevel ?? "medium",
          extendable: false,
          locked: false,
          minutes: minutesBetween(startAt, endAt),
          usedMinutes: 0,
        });
      }
    }

    if (exception.type === "capacity_delta") {
      blocks = applyCapacityDelta(blocks, exception.deltaMinutes ?? 0, date, hardStopTime);
    }
  }

  return blocks.sort((a, b) => a.startAt - b.startAt);
}

export function achievementFor(actualQty, task) {
  if (actualQty < task.minimumQty) return "below_minimum";
  if (actualQty < task.standardQty) return "minimum";
  if (actualQty < task.extraQty) return "standard";
  return "extra";
}

export function elapsedMinutes({
  now,
  startedAt,
  accumulatedPauseMs = 0,
  manualAdjustmentMs = 0,
}) {
  return Math.max(
    0,
    (new Date(now).getTime() -
      new Date(startedAt).getTime() -
      accumulatedPauseMs +
      manualAdjustmentMs) /
      60000,
  );
}

function chooseMaterial({
  materials,
  materialCursors,
  usedRanges,
  date,
  block,
  phase,
  touchedToday,
}) {
  const candidates = materials
    .map((material) => ({ ...material, cursor: materialCursors.get(material.id) }))
    .filter((material) => material.cursor < material.endValue)
    .filter((material) => contextFits(material.context, block.context))
    .filter((material) => !touchedToday.has(`${phase}:${material.id}`))
    .filter((material) => nextRange(material, material.minChunk, materialCursors, usedRanges))
    .sort((a, b) => priorityScore(b, date, block) - priorityScore(a, date, block));

  return candidates[0] ?? null;
}

function addPlannedTask({
  generated,
  taskIndex,
  material,
  date,
  block,
  phase,
  range,
  qty,
  minutes,
}) {
  const key = `${date}:${block.id}:${material.id}`;
  let task = taskIndex.get(key);
  if (!task) {
    task = {
      id: `planned:${key}`,
      date,
      slotId: block.id,
      materialId: material.id,
      materialName: material.name,
      subject: material.subject,
      rangeStart: range.start,
      rangeEnd: range.end,
      unitType: material.unitType,
      context: material.context,
      minimumQty: 0,
      standardQty: 0,
      extraQty: 0,
      actualQty: 0,
      estimatedMinutes: 0,
      status: "planned",
      achievement: "none",
      locked: false,
      revision: 1,
      reason: `Allocated from ${phase} capacity in ${block.label}.`,
      startAt: new Date(block.startAt).toISOString(),
      endAt: new Date(block.endAt).toISOString(),
    };
    taskIndex.set(key, task);
    generated.push(task);
  }

  task.rangeEnd = Math.max(task.rangeEnd, range.end);
  if (phase === "minimum") {
    task.minimumQty += qty;
    task.standardQty = Math.max(task.standardQty, task.minimumQty);
    task.extraQty = Math.max(task.extraQty, task.standardQty);
  }
  if (phase === "standard") {
    task.standardQty += qty;
    task.extraQty = Math.max(task.extraQty, task.standardQty);
  }
  if (phase === "extra") {
    task.extraQty += qty;
  }
  task.estimatedMinutes += minutes;
}

function reserveImmutableCapacity(blocks, immutableTasks, date) {
  const reserved = immutableTasks.filter((task) => task.date === date);
  return blocks.map((block) => {
    const reservedMinutes = reserved
      .filter((task) => task.slotId === block.id || overlapsTaskBlock(task, block))
      .reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
    return {
      ...block,
      usedMinutes: Math.min(block.minutes, reservedMinutes),
    };
  });
}

function overlapsTaskBlock(task, block) {
  if (!task.startAt || !task.endAt) return false;
  const start = new Date(task.startAt).getTime();
  const end = new Date(task.endAt).getTime();
  return start < block.endAt && end > block.startAt;
}

function nextRange(material, qty, materialCursors, usedRanges) {
  let start = materialCursors.get(material.id) ?? material.currentValue;
  const ranges = usedRanges.get(material.id) ?? [];
  while (start < material.endValue) {
    const end = Math.min(material.endValue, start + qty);
    const conflict = ranges.find((range) => start < range.end && end > range.start);
    if (!conflict) return { start, end };
    start = conflict.end;
  }
  return null;
}

function buildUsedRanges(tasks) {
  const used = new Map();
  for (const task of tasks) {
    if (task.materialId && Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)) {
      addUsedRange(used, task.materialId, task.rangeStart, task.rangeEnd);
    }
  }
  return used;
}

function addUsedRange(usedRanges, materialId, start, end) {
  const list = usedRanges.get(materialId) ?? [];
  list.push({ start, end });
  list.sort((a, b) => a.start - b.start);
  usedRanges.set(materialId, list);
}

function totalCompatibleCapacityUntil(material, dates, blocksByDate) {
  return dates
    .filter((date) => date <= material.deadline)
    .flatMap((date) => blocksByDate.get(date) ?? [])
    .filter((block) => contextFits(material.context, block.context))
    .reduce((sum, block) => sum + Math.max(0, block.minutes - block.usedMinutes), 0);
}

function countChangedTasks(existing, generated) {
  const existingSignatures = new Set(existing.map(taskSignature));
  return generated.filter((task) => !existingSignatures.has(taskSignature(task))).length;
}

function stableRevision(tasks, warnings) {
  const text = JSON.stringify({ tasks: tasks.map(taskSignature), warnings });
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function summarize(tasks, warnings, changedTaskCount) {
  return {
    changedTaskCount,
    warningCount: warnings.length,
    plannedMinutes: Math.round(
      tasks
        .filter((task) => task.status === "planned")
        .reduce((sum, task) => sum + task.estimatedMinutes, 0),
    ),
  };
}

function taskSignature(task) {
  return [
    task.date,
    task.slotId,
    task.materialId,
    task.rangeStart,
    task.rangeEnd,
    task.minimumQty,
    task.standardQty,
    task.extraQty,
    task.status,
    task.locked,
  ].join("|");
}

function compareTasks(a, b) {
  return `${a.date}:${a.startAt ?? ""}:${a.materialId}`.localeCompare(
    `${b.date}:${b.startAt ?? ""}:${b.materialId}`,
  );
}

function isImmutableTask(task) {
  return task.locked || task.status === "closed" || task.status === "in_progress";
}

function contextFits(materialContext, blockContext) {
  return materialContext === "either" ||
    blockContext === "either" ||
    materialContext === blockContext;
}

function priorityScore(material, date, block) {
  const daysLeft = Math.max(0, daysBetween(date, material.deadline));
  const deadlineUrgency = Math.max(0, 42 - daysLeft * 6);
  const contextFit = material.context === block.context ? 14 : 5;
  const overdue = date > material.deadline ? 100 : 0;
  const focusBonus = block.focusLevel === "high" && material.context === "desk" ? 6 : 0;
  return (
    material.subjectPriority * 12 +
    material.materialPriority * 8 +
    deadlineUrgency +
    contextFit +
    focusBonus +
    overdue
  );
}

function minutesPerUnit(material) {
  return material.estimatedMinutesPerUnit ?? material.initialMinutesPerUnit ?? 10;
}

function hardStopForDate(date, settings, exceptions) {
  const override = exceptions.find(
    (exception) => exception.date === date && exception.type === "hard_stop_override",
  );
  return override?.endAt ?? settings.hardStopTime;
}

function applyCapacityDelta(blocks, deltaMinutes, date, hardStopTime) {
  if (deltaMinutes === 0) return blocks;
  if (deltaMinutes > 0) {
    const hardStop = timestamp(date, hardStopTime);
    const startAt = hardStop - deltaMinutes * 60000;
    return [
      ...blocks,
      {
        id: `${date}:capacity-delta:${deltaMinutes}`,
        templateId: "capacity-delta",
        date,
        label: "Temporary extra capacity",
        startAt,
        endAt: hardStop,
        context: "either",
        focusLevel: "medium",
        extendable: false,
        locked: false,
        minutes: deltaMinutes,
        usedMinutes: 0,
      },
    ];
  }

  let remainingReduction = Math.abs(deltaMinutes);
  return [...blocks]
    .sort((a, b) => b.endAt - a.endAt)
    .map((block) => {
      if (remainingReduction <= 0) return block;
      const reduction = Math.min(block.minutes, remainingReduction);
      remainingReduction -= reduction;
      const endAt = block.endAt - reduction * 60000;
      return {
        ...block,
        endAt,
        minutes: minutesBetween(block.startAt, endAt),
      };
    })
    .filter((block) => block.minutes > 0)
    .sort((a, b) => a.startAt - b.startAt);
}

function weekdayOf(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function addDays(date, amount) {
  return new Date(new Date(`${date}T00:00:00`).getTime() + amount * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function daysBetween(startDate, endDate) {
  return Math.round(
    (new Date(`${endDate}T00:00:00`).getTime() -
      new Date(`${startDate}T00:00:00`).getTime()) /
      DAY_MS,
  );
}

function timestamp(date, time) {
  return new Date(`${date}T${time}:00`).getTime();
}

function minutesBetween(startAt, endAt) {
  return Math.max(0, (endAt - startAt) / 60000);
}
