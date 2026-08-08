"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { planStudy } from "@/lib/scheduler.mjs";
import { sampleInput } from "@/lib/sampleData.mjs";

type Context = "mobile" | "desk" | "either";
type FocusLevel = "low" | "medium" | "high";

type Material = {
  id: string;
  subject: string;
  name: string;
  phase: string;
  unitType: string;
  startValue: number;
  endValue: number;
  currentValue: number;
  deadline: string;
  subjectPriority: number;
  materialPriority: number;
  context: Context;
  minChunk: number;
  initialMinutesPerUnit: number;
  estimatedMinutesPerUnit: number;
  active: boolean;
};

type ScheduleTemplate = {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  context: Context;
  focusLevel: FocusLevel;
  extendable: boolean;
  label: string;
  active: boolean;
};

type PlannerInput = {
  today: string;
  planningDays: number;
  settings: {
    planningBufferRatio: number;
    softEndTime: string;
    hardStopTime: string;
    nearStartLockMinutes: number;
  };
  scheduleTemplates: ScheduleTemplate[];
  exceptions: unknown[];
  materials: Material[];
  existingTasks: unknown[];
};

type PlannerTask = {
  id: string;
  date: string;
  materialId: string;
  materialName: string;
  subject: string;
  rangeStart: number;
  rangeEnd: number;
  unitType: string;
  minimumQty: number;
  standardQty: number;
  extraQty: number;
  estimatedMinutes: number;
  status: string;
  locked: boolean;
};

const storageKey = "jukentanso-system-v0";
const clientIdKey = "jukentanso-client-id-v0";
const personalCodeKey = "jukentanso-personal-code-v0";
const revisionKey = "jukentanso-sync-revision-v0";
const appName = "受験伴走システム";
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

const seedInput = sampleInput as PlannerInput;

export function StudyPlannerApp() {
  const [planner, setPlanner] = useState<PlannerInput>(() => {
    if (typeof window === "undefined") return seedInput;

    const saved = window.localStorage.getItem(storageKey);
    return saved ? (JSON.parse(saved) as PlannerInput) : seedInput;
  });
  const [activePanel, setActivePanel] = useState<"today" | "materials" | "schedule">("today");
  const [clientId] = useState(() => getOrCreateClientId());
  const [personalCode, setPersonalCode] = useState(() => getStoredValue(personalCodeKey));
  const [remoteRevision, setRemoteRevision] = useState(() =>
    Number(getStoredValue(revisionKey) || 0),
  );
  const [codeInput, setCodeInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState("端末内に保存しています。");

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(planner));
  }, [planner]);

  const result = useMemo(() => planStudy(planner), [planner]);
  const plannedTasks = result.tasks.filter((task: PlannerTask) => task.status === "planned");
  const lockedTasks = result.tasks.filter((task: PlannerTask) => task.locked);
  const subjectMinutes = plannedTasks.reduce<Record<string, number>>((acc, task: PlannerTask) => {
    acc[task.subject] = (acc[task.subject] ?? 0) + task.estimatedMinutes;
    return acc;
  }, {});

  function addMaterial(material: Material) {
    setPlanner((current) => ({
      ...current,
      materials: [...current.materials, material],
    }));
    markDirty();
    setActivePanel("today");
  }

  function addScheduleBlock(block: ScheduleTemplate) {
    setPlanner((current) => ({
      ...current,
      scheduleTemplates: [...current.scheduleTemplates, block],
    }));
    markDirty();
    setActivePanel("today");
  }

  function updateSettings(partial: Partial<PlannerInput["settings"]>) {
    setPlanner((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...partial,
      },
    }));
    markDirty();
  }

  function resetPrototype() {
    setPlanner(seedInput);
    window.localStorage.removeItem(storageKey);
    setDirty(true);
    setSyncStatus("架空データに戻しました。同期する場合は同期ボタンを押してください。");
  }

  function markDirty() {
    setDirty(true);
    setSyncStatus(personalCode ? "未同期の変更があります。" : "端末内に保存しました。");
  }

  async function createPersonalCode() {
    setSyncStatus("個人コードを作成しています。");
    const response = await fetch("/api/device/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, data: planner }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setSyncStatus(payload.message ?? "個人コードの作成に失敗しました。");
      return;
    }

    setPersonalCode(payload.code);
    setRemoteRevision(payload.revision);
    setDirty(false);
    window.localStorage.setItem(personalCodeKey, payload.code);
    window.localStorage.setItem(revisionKey, String(payload.revision));
    setSyncStatus("個人コードを作成して同期しました。");
  }

  async function openPersonalCode() {
    if (!codeInput.trim()) {
      setSyncStatus("個人コードを入力してください。");
      return;
    }

    setSyncStatus("個人コードのデータを開いています。");
    const response = await fetch("/api/device/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeInput }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setSyncStatus(payload.message ?? "個人コードを開けませんでした。");
      return;
    }

    setPlanner(payload.data as PlannerInput);
    setPersonalCode(payload.code);
    setRemoteRevision(payload.revision);
    setDirty(false);
    window.localStorage.setItem(personalCodeKey, payload.code);
    window.localStorage.setItem(revisionKey, String(payload.revision));
    setSyncStatus("個人コードのデータを読み込みました。");
  }

  async function pushSync() {
    if (!personalCode) {
      setSyncStatus("先に個人コードを作成するか、既存コードを開いてください。");
      return;
    }

    setSyncStatus("同期しています。");
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: personalCode,
        clientId,
        data: planner,
        baseRevision: remoteRevision,
        idempotencyKey: createId("sync"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setSyncStatus(payload.message ?? "同期に失敗しました。");
      return;
    }

    setRemoteRevision(payload.revision);
    window.localStorage.setItem(revisionKey, String(payload.revision));

    if (payload.conflict) {
      setPlanner(payload.data as PlannerInput);
      setDirty(false);
      setSyncStatus("別端末の更新が新しかったため、そちらを読み込みました。");
      return;
    }

    setDirty(false);
    setSyncStatus("同期しました。");
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Application summary">
        <div>
          <p className="eyebrow">Prototype</p>
          <h1>{appName}</h1>
        </div>
        <div className="sync-pill">{personalCode ? "個人コード同期" : "端末内保存"}</div>
      </section>

      <nav className="segmented" aria-label="Primary views">
        <button
          className={activePanel === "today" ? "active" : ""}
          type="button"
          onClick={() => setActivePanel("today")}
        >
          今日
        </button>
        <button
          className={activePanel === "materials" ? "active" : ""}
          type="button"
          onClick={() => setActivePanel("materials")}
        >
          教材追加
        </button>
        <button
          className={activePanel === "schedule" ? "active" : ""}
          type="button"
          onClick={() => setActivePanel("schedule")}
        >
          生活時間
        </button>
      </nav>

      <section className="account-panel" aria-label="Personal code sync">
        <div>
          <p className="eyebrow">Sync</p>
          <h2>{personalCode || "個人コード未作成"}</h2>
          <p>{syncStatus}</p>
        </div>
        <div className="account-actions">
          <button className="primary-action" type="button" onClick={createPersonalCode}>
            はじめて使う
          </button>
          <label>
            既に使っている
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="JUKEN-XXXX-XXXX-XXXX"
            />
          </label>
          <button className="secondary-action" type="button" onClick={openPersonalCode}>
            開く
          </button>
          <button className="secondary-action" type="button" onClick={pushSync}>
            {dirty ? "変更を同期" : "同期"}
          </button>
        </div>
      </section>

      {activePanel === "today" && (
        <TodayPanel
          lockedTasks={lockedTasks.length}
          plannedTasks={plannedTasks}
          result={result}
          subjectMinutes={subjectMinutes}
        />
      )}

      {activePanel === "materials" && (
        <MaterialPanel materials={planner.materials} onAdd={addMaterial} />
      )}

      {activePanel === "schedule" && (
        <SchedulePanel
          planner={planner}
          onAdd={addScheduleBlock}
          onReset={resetPrototype}
          onSettingsChange={updateSettings}
        />
      )}
    </main>
  );
}

function TodayPanel({
  lockedTasks,
  plannedTasks,
  result,
  subjectMinutes,
}: {
  lockedTasks: number;
  plannedTasks: PlannerTask[];
  result: ReturnType<typeof planStudy>;
  subjectMinutes: Record<string, number>;
}) {
  return (
    <>
      <section className="summary-grid" aria-label="Scheduler result">
        <Metric label="変更件数" value={`${result.changedTaskCount}件`} tone="blue" />
        <Metric label="予定時間" value={`${result.summary.plannedMinutes}分`} tone="green" />
        <Metric label="警告" value={`${result.warnings.length}件`} tone="amber" />
        <Metric label="固定保持" value={`${lockedTasks}件`} tone="slate" />
      </section>

      <section className="today-band">
        <div>
          <p className="eyebrow">Today</p>
          <h2>今日以降の自動配分</h2>
        </div>
        <span>rev {result.schedulerRevision}</span>
      </section>

      <section className="task-list" aria-label="Planned tasks">
        {plannedTasks.slice(0, 10).map((task) => (
          <article className="task-card" key={task.id}>
            <div className="task-main">
              <span className="subject">{task.subject}</span>
              <h3>{task.materialName}</h3>
              <p>
                {task.rangeStart}〜{task.rangeEnd}
                {task.unitType} / {Math.round(task.estimatedMinutes)}分
              </p>
            </div>
            <div className="thresholds" aria-label="Thresholds">
              <span>最低 {task.minimumQty}</span>
              <span>標準 {task.standardQty}</span>
              <span>追加 {task.extraQty}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="two-column">
        <div className="panel">
          <h2>科目別予定時間</h2>
          <div className="bars">
            {Object.entries(subjectMinutes).map(([subject, minutes]) => (
              <div className="bar-row" key={subject}>
                <span>{subject}</span>
                <div>
                  <i style={{ width: `${Math.min(100, minutes)}%` }} />
                </div>
                <b>{Math.round(minutes)}分</b>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>検出された警告</h2>
          {result.warnings.length === 0 ? (
            <p className="quiet">実現困難な教材はありません。</p>
          ) : (
            <ul className="warning-list">
              {result.warnings.map((warning) => (
                <li key={`${warning.code}:${warning.materialId}`}>{warning.message}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function MaterialPanel({
  materials,
  onAdd,
}: {
  materials: Material[];
  onAdd: (material: Material) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onAdd({
      id: createId("material"),
      subject: value(data, "subject"),
      name: value(data, "name"),
      phase: value(data, "phase"),
      unitType: value(data, "unitType"),
      startValue: numberValue(data, "startValue"),
      endValue: numberValue(data, "endValue"),
      currentValue: numberValue(data, "currentValue"),
      deadline: value(data, "deadline"),
      subjectPriority: numberValue(data, "subjectPriority"),
      materialPriority: numberValue(data, "materialPriority"),
      context: value(data, "context") as Context,
      minChunk: numberValue(data, "minChunk"),
      initialMinutesPerUnit: numberValue(data, "minutesPerUnit"),
      estimatedMinutesPerUnit: numberValue(data, "minutesPerUnit"),
      active: true,
    });
    event.currentTarget.reset();
  }

  return (
    <section className="form-layout">
      <form className="entry-form" onSubmit={submit}>
        <div>
          <p className="eyebrow">Material</p>
          <h2>教材を追加</h2>
        </div>
        <label>
          科目
          <input name="subject" placeholder="英語" required />
        </label>
        <label>
          教材名
          <input name="name" placeholder="英単語ターゲット" required />
        </label>
        <div className="form-grid">
          <label>
            フェーズ
            <input name="phase" defaultValue="初見" required />
          </label>
          <label>
            単位
            <select name="unitType" defaultValue="題">
              <option>題</option>
              <option>ページ</option>
              <option>語</option>
              <option>セット</option>
              <option>回</option>
            </select>
          </label>
          <label>
            現在位置
            <input name="currentValue" defaultValue="1" min="0" type="number" required />
          </label>
          <label>
            終了位置
            <input name="endValue" defaultValue="40" min="1" type="number" required />
          </label>
          <label>
            開始位置
            <input name="startValue" defaultValue="1" min="0" type="number" required />
          </label>
          <label>
            期限
            <input name="deadline" defaultValue="2026-08-31" type="date" required />
          </label>
          <label>
            科目優先度
            <input name="subjectPriority" defaultValue="4" max="5" min="1" type="number" />
          </label>
          <label>
            教材優先度
            <input name="materialPriority" defaultValue="4" max="5" min="1" type="number" />
          </label>
          <label>
            場所
            <select name="context" defaultValue="desk">
              <option value="mobile">通学</option>
              <option value="desk">机</option>
              <option value="either">どちらでも可</option>
            </select>
          </label>
          <label>
            最小分割量
            <input name="minChunk" defaultValue="2" min="0.1" step="0.1" type="number" />
          </label>
          <label>
            分 / 単位
            <input name="minutesPerUnit" defaultValue="10" min="0.1" step="0.1" type="number" />
          </label>
        </div>
        <button className="primary-action" type="submit">
          追加して再計算
        </button>
      </form>

      <div className="panel">
        <h2>登録済み教材</h2>
        <div className="compact-list">
          {materials.map((material) => (
            <div key={material.id}>
              <b>{material.subject}</b>
              <span>{material.name}</span>
              <small>
                {material.currentValue}〜{material.endValue}
                {material.unitType}
              </small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SchedulePanel({
  planner,
  onAdd,
  onReset,
  onSettingsChange,
}: {
  planner: PlannerInput;
  onAdd: (block: ScheduleTemplate) => void;
  onReset: () => void;
  onSettingsChange: (partial: Partial<PlannerInput["settings"]>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onAdd({
      id: createId("slot"),
      weekday: numberValue(data, "weekday"),
      startTime: value(data, "startTime"),
      endTime: value(data, "endTime"),
      context: value(data, "context") as Context,
      focusLevel: value(data, "focusLevel") as FocusLevel,
      extendable: data.get("extendable") === "on",
      label: value(data, "label"),
      active: true,
    });
    event.currentTarget.reset();
  }

  return (
    <section className="form-layout">
      <div className="entry-form">
        <div>
          <p className="eyebrow">Life</p>
          <h2>生活時間</h2>
        </div>
        <div className="form-grid">
          <label>
            ソフト終了
            <input
              type="time"
              value={planner.settings.softEndTime}
              onChange={(event) => {
                if (event.target.value) onSettingsChange({ softEndTime: event.target.value });
              }}
            />
          </label>
          <label>
            ハード停止
            <input
              type="time"
              value={planner.settings.hardStopTime}
              onChange={(event) => {
                if (event.target.value) onSettingsChange({ hardStopTime: event.target.value });
              }}
            />
          </label>
        </div>
        <button className="secondary-action" type="button" onClick={onReset}>
          架空データへ戻す
        </button>
      </div>

      <form className="entry-form" onSubmit={submit}>
        <div>
          <p className="eyebrow">Study Block</p>
          <h2>学習枠を追加</h2>
        </div>
        <label>
          ラベル
          <input name="label" placeholder="帰宅後" required />
        </label>
        <div className="form-grid">
          <label>
            曜日
            <select name="weekday" defaultValue="1">
              {weekdays.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            開始
            <input name="startTime" type="time" defaultValue="19:00" required />
          </label>
          <label>
            終了
            <input name="endTime" type="time" defaultValue="21:00" required />
          </label>
          <label>
            場所
            <select name="context" defaultValue="desk">
              <option value="mobile">通学</option>
              <option value="desk">机</option>
              <option value="either">どちらでも可</option>
            </select>
          </label>
          <label>
            集中度
            <select name="focusLevel" defaultValue="medium">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label className="check-row">
            <input name="extendable" type="checkbox" />
            延長可
          </label>
        </div>
        <button className="primary-action" type="submit">
          追加して再計算
        </button>
      </form>

      <div className="panel">
        <h2>登録済み学習枠</h2>
        <div className="compact-list">
          {planner.scheduleTemplates.map((block) => (
            <div key={`${block.weekday}:${block.id}:${block.startTime}`}>
              <b>{weekdays[block.weekday]}曜</b>
              <span>{block.label}</span>
              <small>
                {block.startTime}〜{block.endTime}
              </small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "slate";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function getStoredValue(key: string) {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}

function getOrCreateClientId() {
  if (typeof window === "undefined") return "";

  const current = window.localStorage.getItem(clientIdKey);
  if (current) return current;

  const next = createId("client");
  window.localStorage.setItem(clientIdKey, next);
  return next;
}

function value(data: FormData, key: string) {
  return String(data.get(key) ?? "");
}

function numberValue(data: FormData, key: string) {
  return Number(data.get(key) ?? 0);
}
