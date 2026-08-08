export type PlannedTask = {
  id: string;
  date: string;
  slotId: string;
  materialId: string;
  materialName: string;
  subject: string;
  rangeStart: number;
  rangeEnd: number;
  unitType: string;
  context?: string;
  minimumQty: number;
  standardQty: number;
  extraQty: number;
  actualQty: number;
  estimatedMinutes: number;
  status: string;
  achievement: string;
  locked: boolean;
  revision: number;
  reason?: string;
  startAt?: string;
  endAt?: string;
};

export type SchedulerWarning = {
  code: string;
  materialId?: string;
  message: string;
};

export type SchedulerResult = {
  tasks: PlannedTask[];
  changedTaskCount: number;
  warnings: SchedulerWarning[];
  schedulerRevision: number;
  summary: {
    changedTaskCount: number;
    warningCount: number;
    plannedMinutes: number;
  };
};

export function planStudy(input: unknown): SchedulerResult;
export function achievementFor(actualQty: number, task: {
  minimumQty: number;
  standardQty: number;
  extraQty: number;
}): "below_minimum" | "minimum" | "standard" | "extra";
export function elapsedMinutes(input: {
  now: string;
  startedAt: string;
  accumulatedPauseMs?: number;
  manualAdjustmentMs?: number;
}): number;
