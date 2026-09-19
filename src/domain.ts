import type { DrillRun, Hole, Sample, SampleKind, Store } from "./types";

export const EPS = 1e-6;
/** 深度比较容差：0.5cm */
export const DEPTH_TOL = 0.005;

export const fmt = (n: number) => n.toFixed(2);

export const SAMPLE_KINDS: SampleKind[] = ["原状样", "扰动样", "岩样"];

export const LITHOLOGIES = [
  "黏土",
  "粉质黏土",
  "粉砂",
  "细砂",
  "中粗砂",
  "卵石",
  "强风化泥岩",
  "中风化岩",
];

/* ---------- 查询 ---------- */

export function holeRuns(store: Store, holeId: string): DrillRun[] {
  return store.runs
    .filter((r) => r.holeId === holeId)
    .sort((a, b) => a.startDepth - b.startDepth);
}

export function holeSamples(store: Store, holeId: string): Sample[] {
  return store.samples
    .filter((s) => s.holeId === holeId)
    .sort((a, b) => a.depthFrom - b.depthFrom || a.code.localeCompare(b.code));
}

export function holeHandovers(store: Store, holeId: string) {
  return store.handovers
    .filter((h) => h.holeId === holeId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** 未被更正取代的现行样品 */
export function activeSamples(samples: Sample[]): Sample[] {
  return samples.filter((s) => !s.supersededBy);
}

export function pendingSamples(samples: Sample[]): Sample[] {
  return activeSamples(samples).filter((s) => s.status === "pending");
}

/* ---------- 回次规则 ---------- */

/** 下一回次必须承接的起点：已登记回次的最大终点（无回次时为孔口 0） */
export function expectedStartDepth(runs: DrillRun[]): number {
  return runs.length ? Math.max(...runs.map((r) => r.endDepth)) : 0;
}

export interface RunInput {
  startDepth: number;
  endDepth: number;
  footage: number;
  lithology: string;
  recovery: number;
}

/** 返回错误文案；null 表示可登记 */
export function validateRun(
  input: RunInput,
  existing: DrillRun[],
  hole: Hole
): string | null {
  const expected = expectedStartDepth(existing);
  if (Math.abs(input.startDepth - expected) > DEPTH_TOL) {
    return `回次起点必须承接上一回次终点 ${fmt(expected)}m`;
  }
  if (!(input.endDepth > input.startDepth + EPS)) {
    return "终止深度必须大于起始深度";
  }
  if (input.endDepth > hole.designDepth + DEPTH_TOL) {
    return `终止深度不能超过设计孔深 ${fmt(hole.designDepth)}m`;
  }
  if (Math.abs(input.footage - (input.endDepth - input.startDepth)) > DEPTH_TOL) {
    return `回次进尺必须等于起止深度之差 ${fmt(
      input.endDepth - input.startDepth
    )}m`;
  }
  if (!input.lithology.trim()) {
    return "请填写主要岩性";
  }
  if (!(input.recovery >= 0 && input.recovery <= 100)) {
    return "采取率应在 0–100% 之间";
  }
  if (input.recovery < hole.recoveryThreshold) {
    return `采取率 ${input.recovery}% 低于下限 ${hole.recoveryThreshold}%，不得登记，该井段记为缺失`;
  }
  return null;
}

/** 缺失井段：[孔口, 设计孔深] 内未被已登记回次覆盖的区间 */
export function missingIntervals(
  runs: DrillRun[],
  designDepth: number
): Array<[number, number]> {
  const sorted = [...runs].sort((a, b) => a.startDepth - b.startDepth);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.startDepth > cursor + DEPTH_TOL) gaps.push([cursor, r.startDepth]);
    cursor = Math.max(cursor, r.endDepth);
  }
  if (cursor < designDepth - DEPTH_TOL) gaps.push([cursor, designDepth]);
  return gaps;
}

/* ---------- 取样规则 ---------- */

/** 完整包含 [from, to] 的回次；不存在则说明落在缺失井段或跨越回次边界 */
export function findContainingRun(
  runs: DrillRun[],
  from: number,
  to: number
): DrillRun | null {
  return (
    runs.find(
      (r) => r.startDepth - DEPTH_TOL <= from && to <= r.endDepth + DEPTH_TOL
    ) ?? null
  );
}

export interface SampleInput {
  kind: SampleKind;
  depthFrom: number;
  depthTo: number;
}

/** 返回错误文案；null 表示可登记 */
export function validateSample(
  input: SampleInput,
  runs: DrillRun[],
  hole: Hole
): string | null {
  if (!(input.depthTo > input.depthFrom + EPS)) {
    return "取样区间终止深度必须大于起始深度";
  }
  if (input.depthFrom < -DEPTH_TOL || input.depthTo > hole.designDepth + DEPTH_TOL) {
    return `取样区间超出孔深范围 0–${fmt(hole.designDepth)}m`;
  }
  const run = findContainingRun(runs, input.depthFrom, input.depthTo);
  if (!run) {
    const overlaps = runs.some(
      (r) => input.depthFrom < r.endDepth - EPS && input.depthTo > r.startDepth + EPS
    );
    if (input.kind === "原状样") {
      return overlaps
        ? "原状样跨越回次边界，必须完整落在同一回次内"
        : "原状样所在井段尚未登记回次，不得取样";
    }
    return overlaps
      ? "取样区间跨越回次边界，须完整落在同一回次内"
      : "取样区间所在井段尚未登记回次";
  }
  return null;
}

/** 同孔同深（相同取样区间）的现行样品分组，长度 >1 即为重复 */
export function duplicateGroups(samples: Sample[]): Sample[][] {
  const groups = new Map<string, Sample[]>();
  for (const s of activeSamples(samples)) {
    const key = `${s.depthFrom.toFixed(2)}|${s.depthTo.toFixed(2)}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function isDuplicate(samples: Sample[], target: Sample): boolean {
  return duplicateGroups(samples).some((g) => g.some((s) => s.id === target.id));
}

/* ---------- 交班规则 ---------- */

/** 返回错误文案；null 表示可移交 */
export function validateHandover(holeSampleList: Sample[]): string | null {
  const pending = pendingSamples(holeSampleList);
  if (pending.length === 0) {
    return "没有待移交的样品";
  }
  const dups = duplicateGroups(holeSampleList);
  if (dups.length > 0) {
    const detail = dups
      .map(
        (g) =>
          `${fmt(g[0].depthFrom)}–${fmt(g[0].depthTo)}m（${g
            .map((s) => s.code)
            .join("、")}）`
      )
      .join("；");
    return `同孔同深重复取样：${detail}，请删除或更正后再移交`;
  }
  return null;
}

/** 回次是否可删除：只能删除最深回次，且其中无任何样品 */
export function canDeleteRun(run: DrillRun, store: Store): string | null {
  const runs = holeRuns(store, run.holeId);
  const deepest = runs[runs.length - 1];
  if (!deepest || deepest.id !== run.id) {
    return "只能删除最深的回次，以保证回次连续承接";
  }
  if (store.samples.some((s) => s.runId === run.id)) {
    return "该回次内已登记样品，不能删除";
  }
  return null;
}
