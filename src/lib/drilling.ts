// 钻探回次与取样移交的领域模型与业务规则。
// 本模块只包含纯数据与纯函数，UI 层（App.tsx）负责调用并落盘。

export const MIN_RECOVERY = 65; // 回次采取率下限（%），不足不得登记
export const STORAGE_KEY = "hxwl03.drilling.v1";

export interface DrillRun {
  id: string;
  holeId: string;
  seq: number; // 回次序号（按孔递增）
  startDepth: number; // 起始深度 m，必须承接上一回次终点
  endDepth: number; // 终止深度 m
  advance: number; // 回次进尺 m = endDepth - startDepth
  lithology: string; // 主要岩性
  coreLength: number; // 岩心采取长度 m
  recovery: number; // 采取率 %
  createdAt: string;
}

export type SampleKind = "原状样" | "扰动样";

export interface Sample {
  id: string;
  code: string; // 样品编号，如 ZK-18-T01
  holeId: string;
  runId: string; // 所属回次，取样深度必须落在该回次内
  depth: number; // 取样深度 m
  kind: SampleKind;
  note: string;
  status: "draft" | "frozen"; // 交班后冻结
  handoverId: string | null;
  correctionOf: string | null; // 更正副本 → 原记录
  correctionReason: string | null;
  supersededBy: string | null; // 原记录 → 更正副本
  createdAt: string;
}

export interface Handover {
  id: string;
  no: string; // 交班编号
  holeId: string;
  sampleIds: string[]; // 交班时冻结的样品
  from: string; // 交班人
  to: string; // 接班人
  at: string;
}

export interface MissingSegment {
  id: string;
  holeId: string;
  startDepth: number;
  endDepth: number;
  lithology: string;
  recovery: number; // 当时申报的采取率
  reason: string;
  status: "open" | "covered"; // covered = 后续回次已补钻覆盖
  coveredByRunId: string | null;
  createdAt: string;
}

export interface AppState {
  version: 1;
  holes: string[];
  runs: DrillRun[];
  samples: Sample[];
  handovers: Handover[];
  missing: MissingSegment[];
  runSeq: Record<string, number>; // 每孔回次计数
  sampleSeq: Record<string, number>; // 每孔样品计数
  handoverSeq: number;
}

// ---------- 基础工具 ----------

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round1 = (n: number): number => Math.round(n * 10) / 10;

export function holeRuns(state: AppState, holeId: string): DrillRun[] {
  return state.runs
    .filter((r) => r.holeId === holeId)
    .sort((a, b) => a.startDepth - b.startDepth);
}

/** 当前孔已登记回次的最大终深；无回次时为 0（孔口）。 */
export function lastRunEnd(state: AppState, holeId: string): number {
  const runs = holeRuns(state, holeId);
  return runs.length ? runs[runs.length - 1].endDepth : 0;
}

export function calcRecovery(advance: number, coreLength: number): number {
  if (advance <= 0) return 0;
  return round1((coreLength / advance) * 100);
}

// ---------- 回次登记 ----------

export interface RunDraft {
  holeId: string;
  startDepth: number;
  endDepth: number;
  lithology: string;
  coreLength: number;
}

export function validateRunDraft(state: AppState, draft: RunDraft): string[] {
  const errors: string[] = [];
  if (!draft.lithology.trim()) errors.push("请填写主要岩性");
  if (!Number.isFinite(draft.endDepth)) errors.push("请填写终止深度");
  if (!Number.isFinite(draft.coreLength)) errors.push("请填写岩心采取长度");
  if (errors.length) return errors;

  if (draft.endDepth <= draft.startDepth) {
    errors.push("终止深度必须大于起始深度");
  }
  const expected = lastRunEnd(state, draft.holeId);
  if (round2(draft.startDepth) !== round2(expected)) {
    errors.push(
      `回次起点 ${draft.startDepth.toFixed(2)}m 未承接上一回次终点 ${expected.toFixed(2)}m`
    );
  }
  if (draft.coreLength < 0) errors.push("岩心采取长度不能为负");
  const advance = round2(draft.endDepth - draft.startDepth);
  if (advance > 0 && draft.coreLength > advance) {
    errors.push("岩心采取长度不能超过回次进尺");
  }
  return errors;
}

export type RunResult =
  | { ok: true; run: DrillRun; coveredMissing: number }
  | { ok: false; recovery: number; missing: MissingSegment };

/**
 * 登记回次。采取率不足时不登记，转为缺失井段记录；
 * 登记成功后，凡被连续回次覆盖的缺失井段自动闭合。
 */
export function registerRun(
  state: AppState,
  draft: RunDraft
): { next: AppState; result: RunResult } {
  const advance = round2(draft.endDepth - draft.startDepth);
  const recovery = calcRecovery(advance, draft.coreLength);

  if (recovery < MIN_RECOVERY) {
    const missing: MissingSegment = {
      id: uid("ms"),
      holeId: draft.holeId,
      startDepth: round2(draft.startDepth),
      endDepth: round2(draft.endDepth),
      lithology: draft.lithology.trim(),
      recovery,
      reason: `采取率 ${recovery}% 低于下限 ${MIN_RECOVERY}%`,
      status: "open",
      coveredByRunId: null,
      createdAt: new Date().toISOString(),
    };
    return {
      next: { ...state, missing: [...state.missing, missing] },
      result: { ok: false, recovery, missing },
    };
  }

  const seq = (state.runSeq[draft.holeId] ?? 0) + 1;
  const run: DrillRun = {
    id: uid("run"),
    holeId: draft.holeId,
    seq,
    startDepth: round2(draft.startDepth),
    endDepth: round2(draft.endDepth),
    advance,
    lithology: draft.lithology.trim(),
    coreLength: round2(draft.coreLength),
    recovery,
    createdAt: new Date().toISOString(),
  };

  // 回次自孔口连续登记，最大终深盖过缺失井段终点即视为已补钻
  let coveredMissing = 0;
  const missing = state.missing.map((m) => {
    if (m.holeId === draft.holeId && m.status === "open" && m.endDepth <= run.endDepth) {
      coveredMissing += 1;
      return { ...m, status: "covered" as const, coveredByRunId: run.id };
    }
    return m;
  });

  const next: AppState = {
    ...state,
    runs: [...state.runs, run],
    missing,
    runSeq: { ...state.runSeq, [draft.holeId]: seq },
  };
  return { next, result: { ok: true, run, coveredMissing } };
}

// ---------- 取样登记 ----------

export interface SampleDraft {
  holeId: string;
  runId: string;
  depth: number;
  kind: SampleKind;
  note: string;
}

export function validateSampleDraft(state: AppState, draft: SampleDraft): string[] {
  const errors: string[] = [];
  const run = state.runs.find((r) => r.id === draft.runId);
  if (!run) {
    errors.push("请选择所属回次");
    return errors;
  }
  if (run.holeId !== draft.holeId) errors.push("回次与当前钻孔不匹配");
  if (!Number.isFinite(draft.depth)) {
    errors.push("请填写取样深度");
    return errors;
  }
  const d = round2(draft.depth);
  if (d < run.startDepth || d > run.endDepth) {
    errors.push(
      `取样深度 ${d.toFixed(2)}m 不在回次 ${run.seq}（${run.startDepth.toFixed(2)}–${run.endDepth.toFixed(2)}m）范围内，原状样只能落在同一回次内`
    );
  }
  return errors;
}

export function addSample(
  state: AppState,
  draft: SampleDraft
): { next: AppState; sample: Sample } {
  const seq = (state.sampleSeq[draft.holeId] ?? 0) + 1;
  const sample: Sample = {
    id: uid("sp"),
    code: `${draft.holeId}-T${String(seq).padStart(2, "0")}`,
    holeId: draft.holeId,
    runId: draft.runId,
    depth: round2(draft.depth),
    kind: draft.kind,
    note: draft.note.trim(),
    status: "draft",
    handoverId: null,
    correctionOf: null,
    correctionReason: null,
    supersededBy: null,
    createdAt: new Date().toISOString(),
  };
  return {
    next: {
      ...state,
      samples: [...state.samples, sample],
      sampleSeq: { ...state.sampleSeq, [draft.holeId]: seq },
    },
    sample,
  };
}

// ---------- 交班 ----------

export interface DepthConflict {
  depth: number;
  codes: string[];
}

/**
 * 移交前查重：在当前孔「已冻结 ∪ 本次拟移交」的有效样品
 * （未被更正副本取代者）中，同孔同深出现两件及以上即冲突。
 */
export function handoverConflicts(
  state: AppState,
  holeId: string,
  selectedIds: string[]
): DepthConflict[] {
  const selected = new Set(selectedIds);
  const inScope = state.samples.filter(
    (s) =>
      s.holeId === holeId &&
      !s.supersededBy &&
      (s.status === "frozen" || selected.has(s.id))
  );
  const byDepth = new Map<number, Sample[]>();
  for (const s of inScope) {
    const key = round2(s.depth);
    byDepth.set(key, [...(byDepth.get(key) ?? []), s]);
  }
  return [...byDepth.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([depth, list]) => ({
      depth,
      codes: list.map((s) => s.code).sort(),
    }))
    .sort((a, b) => a.depth - b.depth);
}

export function applyHandover(
  state: AppState,
  holeId: string,
  selectedIds: string[],
  from: string,
  to: string
): { next: AppState; handover: Handover } {
  const no = `交班-${String(state.handoverSeq + 1).padStart(2, "0")}`;
  const handover: Handover = {
    id: uid("ho"),
    no,
    holeId,
    sampleIds: [...selectedIds],
    from: from.trim(),
    to: to.trim(),
    at: new Date().toISOString(),
  };
  const selected = new Set(selectedIds);
  const samples = state.samples.map((s) =>
    selected.has(s.id) && s.status === "draft"
      ? { ...s, status: "frozen" as const, handoverId: handover.id }
      : s
  );
  return {
    next: {
      ...state,
      samples,
      handovers: [...state.handovers, handover],
      handoverSeq: state.handoverSeq + 1,
    },
    handover,
  };
}

// ---------- 冻结样品的更正副本 ----------

export interface CorrectionPatch {
  runId: string;
  depth: number;
  kind: SampleKind;
  reason: string;
}

/**
 * 已交班样品不可改：保留原记录，新建一条带原因的冻结副本，
 * 原记录标记 supersededBy 后退出查重与统计。
 */
export function correctSample(
  state: AppState,
  originalId: string,
  patch: CorrectionPatch
): { next?: AppState; copy?: Sample; error?: string } {
  const original = state.samples.find((s) => s.id === originalId);
  if (!original) return { error: "未找到原记录" };
  if (original.status !== "frozen") return { error: "未交班的样品可直接删除重录，无需更正" };
  if (original.supersededBy) return { error: "该记录已被更正，请对最新的更正副本操作" };
  if (!patch.reason.trim()) return { error: "请填写更正原因" };

  const run = state.runs.find((r) => r.id === patch.runId);
  if (!run || run.holeId !== original.holeId) return { error: "所属回次无效" };
  if (!Number.isFinite(patch.depth)) return { error: "请填写更正后的取样深度" };
  const d = round2(patch.depth);
  if (d < run.startDepth || d > run.endDepth) {
    return {
      error: `更正深度 ${d.toFixed(2)}m 不在回次 ${run.seq}（${run.startDepth.toFixed(2)}–${run.endDepth.toFixed(2)}m）范围内`,
    };
  }
  const dup = state.samples.find(
    (s) =>
      s.holeId === original.holeId &&
      !s.supersededBy &&
      s.id !== original.id &&
      round2(s.depth) === d
  );
  if (dup) {
    return { error: `与 ${dup.code} 同孔同深（${d.toFixed(2)}m）重复，无法生成副本` };
  }

  const seq = (state.sampleSeq[original.holeId] ?? 0) + 1;
  const copy: Sample = {
    id: uid("sp"),
    code: `${original.holeId}-T${String(seq).padStart(2, "0")}`,
    holeId: original.holeId,
    runId: patch.runId,
    depth: d,
    kind: patch.kind,
    note: original.note,
    status: "frozen",
    handoverId: original.handoverId,
    correctionOf: original.id,
    correctionReason: patch.reason.trim(),
    supersededBy: null,
    createdAt: new Date().toISOString(),
  };
  const samples = state.samples
    .map((s) => (s.id === original.id ? { ...s, supersededBy: copy.id } : s))
    .concat(copy);
  return {
    next: {
      ...state,
      samples,
      sampleSeq: { ...state.sampleSeq, [original.holeId]: seq },
    },
    copy,
  };
}

// ---------- 落盘 ----------

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AppState;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.runs) ||
      !Array.isArray(parsed.samples) ||
      !Array.isArray(parsed.handovers) ||
      !Array.isArray(parsed.missing)
    ) {
      return seedState();
    }
    return parsed;
  } catch {
    return seedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用（隐私模式等）时静默降级为内存态
  }
}

// ---------- 演示数据 ----------

export function seedState(): AppState {
  const runs: DrillRun[] = [
    { id: "seed-run-1", holeId: "ZK-18", seq: 1, startDepth: 0, endDepth: 2, advance: 2, lithology: "粉质黏土", coreLength: 1.9, recovery: 95, createdAt: "2026-09-18T01:10:00.000Z" },
    { id: "seed-run-2", holeId: "ZK-18", seq: 2, startDepth: 2, endDepth: 4, advance: 2, lithology: "粉质黏土", coreLength: 1.85, recovery: 92.5, createdAt: "2026-09-18T02:00:00.000Z" },
    { id: "seed-run-3", holeId: "ZK-18", seq: 3, startDepth: 4, endDepth: 6.2, advance: 2.2, lithology: "中砂", coreLength: 1.8, recovery: 81.8, createdAt: "2026-09-18T03:20:00.000Z" },
  ];
  const samples: Sample[] = [
    { id: "seed-sp-1", code: "ZK-18-T01", holeId: "ZK-18", runId: "seed-run-1", depth: 1.5, kind: "原状样", note: "塑料管封装", status: "frozen", handoverId: "seed-ho-1", correctionOf: null, correctionReason: null, supersededBy: null, createdAt: "2026-09-18T04:00:00.000Z" },
    { id: "seed-sp-2", code: "ZK-18-T02", holeId: "ZK-18", runId: "seed-run-2", depth: 3.2, kind: "原状样", note: "", status: "frozen", handoverId: "seed-ho-1", correctionOf: null, correctionReason: null, supersededBy: "seed-sp-3", createdAt: "2026-09-18T04:05:00.000Z" },
    { id: "seed-sp-3", code: "ZK-18-T03", holeId: "ZK-18", runId: "seed-run-2", depth: 3.4, kind: "原状样", note: "", status: "frozen", handoverId: "seed-ho-1", correctionOf: "seed-sp-2", correctionReason: "取样深度记录笔误，实测为 3.40m", supersededBy: null, createdAt: "2026-09-18T06:30:00.000Z" },
    { id: "seed-sp-4", code: "ZK-18-T04", holeId: "ZK-18", runId: "seed-run-3", depth: 5.4, kind: "扰动样", note: "袋装", status: "draft", handoverId: null, correctionOf: null, correctionReason: null, supersededBy: null, createdAt: "2026-09-18T07:00:00.000Z" },
  ];
  const handovers: Handover[] = [
    { id: "seed-ho-1", no: "交班-01", holeId: "ZK-18", sampleIds: ["seed-sp-1", "seed-sp-2"], from: "张工", to: "李工", at: "2026-09-18T09:00:00.000Z" },
  ];
  const missing: MissingSegment[] = [
    { id: "seed-ms-1", holeId: "ZK-21", startDepth: 0, endDepth: 1.8, lithology: "素填土", recovery: 55.6, reason: "采取率 55.6% 低于下限 65%", status: "open", coveredByRunId: null, createdAt: "2026-09-18T05:10:00.000Z" },
  ];
  return {
    version: 1,
    holes: ["ZK-18", "ZK-21", "ZK-24"],
    runs,
    samples,
    handovers,
    missing,
    runSeq: { "ZK-18": 3 },
    sampleSeq: { "ZK-18": 4 },
    handoverSeq: 1,
  };
}
