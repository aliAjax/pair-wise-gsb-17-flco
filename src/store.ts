import type { DrillRun, Handover, Sample, Store } from "./types";

const STORAGE_KEY = "hxwl03-borehole-log-v1";

/* ---------- 初始示例数据（满足全部业务规则） ---------- */

export function seedStore(): Store {
  const holes = [
    { id: "ZK-18", designDepth: 30, recoveryThreshold: 65 },
    { id: "ZK-21", designDepth: 35, recoveryThreshold: 65 },
    { id: "ZK-24", designDepth: 25, recoveryThreshold: 65 },
  ];

  const runs: DrillRun[] = [
    {
      id: "run-ZK-18-1",
      holeId: "ZK-18",
      seq: 1,
      startDepth: 0,
      endDepth: 2.0,
      footage: 2.0,
      lithology: "黏土",
      recovery: 91,
      createdAt: "2026-09-18T08:20:00.000Z",
    },
    {
      id: "run-ZK-18-2",
      holeId: "ZK-18",
      seq: 2,
      startDepth: 2.0,
      endDepth: 4.2,
      footage: 2.2,
      lithology: "粉质黏土",
      recovery: 88,
      createdAt: "2026-09-18T10:05:00.000Z",
    },
    {
      id: "run-ZK-18-3",
      holeId: "ZK-18",
      seq: 3,
      startDepth: 4.2,
      endDepth: 6.0,
      footage: 1.8,
      lithology: "粉砂",
      recovery: 72,
      createdAt: "2026-09-18T13:40:00.000Z",
    },
  ];

  const samples: Sample[] = [
    {
      id: "smp-1",
      code: "ZK-18-S01",
      holeId: "ZK-18",
      runId: "run-ZK-18-1",
      kind: "原状样",
      depthFrom: 1.2,
      depthTo: 1.5,
      status: "handed",
      handoverId: "hov-1",
      createdAt: "2026-09-18T09:10:00.000Z",
    },
    {
      id: "smp-2",
      code: "ZK-18-S02",
      holeId: "ZK-18",
      runId: "run-ZK-18-2",
      kind: "原状样",
      depthFrom: 3.0,
      depthTo: 3.3,
      status: "pending",
      createdAt: "2026-09-18T11:30:00.000Z",
    },
  ];

  const handovers: Handover[] = [
    {
      id: "hov-1",
      code: "ZK-18-J01",
      holeId: "ZK-18",
      sampleIds: ["smp-1"],
      from: "张工",
      to: "李工",
      note: "早班交晚班",
      at: "2026-09-18T14:00:00.000Z",
    },
  ];

  return {
    version: 1,
    holes,
    runs,
    samples,
    handovers,
    counters: { run: 3, sample: 2, handover: 1 },
  };
}

/* ---------- 落盘：localStorage ---------- */

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedStore();
    const parsed = JSON.parse(raw) as Store;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.holes) ||
      !Array.isArray(parsed.runs) ||
      !Array.isArray(parsed.samples) ||
      !Array.isArray(parsed.handovers)
    ) {
      return seedStore();
    }
    return parsed;
  } catch {
    return seedStore();
  }
}

export function saveStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用时静默失败，页面内状态仍可用
  }
}

export function isValidStore(value: unknown): value is Store {
  const s = value as Store;
  return (
    !!s &&
    s.version === 1 &&
    Array.isArray(s.holes) &&
    Array.isArray(s.runs) &&
    Array.isArray(s.samples) &&
    Array.isArray(s.handovers) &&
    !!s.counters
  );
}

/* ---------- 纯函数式变更 ---------- */

export function appendRun(store: Store, run: DrillRun): Store {
  return {
    ...store,
    runs: [...store.runs, run],
    counters: { ...store.counters, run: store.counters.run + 1 },
  };
}

export function removeRun(store: Store, runId: string): Store {
  return { ...store, runs: store.runs.filter((r) => r.id !== runId) };
}

export function appendSample(store: Store, sample: Sample): Store {
  return {
    ...store,
    samples: [...store.samples, sample],
    counters: { ...store.counters, sample: store.counters.sample + 1 },
  };
}

/** 删除样品；若删的是更正副本，则恢复原记录的现行状态 */
export function removeSample(store: Store, sampleId: string): Store {
  const target = store.samples.find((s) => s.id === sampleId);
  const samples = store.samples.filter((s) => s.id !== sampleId);
  if (target?.originId) {
    return {
      ...store,
      samples: samples.map((s) =>
        s.id === target.originId ? { ...s, supersededBy: undefined } : s
      ),
    };
  }
  return { ...store, samples };
}

/** 交班：批次内样品转为已移交（冻结） */
export function applyHandover(store: Store, handover: Handover): Store {
  return {
    ...store,
    handovers: [...store.handovers, handover],
    samples: store.samples.map((s) =>
      handover.sampleIds.includes(s.id)
        ? { ...s, status: "handed" as const, handoverId: handover.id }
        : s
    ),
    counters: { ...store.counters, handover: store.counters.handover + 1 },
  };
}

/** 更正：原记录保留并标记被取代，追加带原因的副本 */
export function applyCorrection(
  store: Store,
  originId: string,
  copy: Sample
): Store {
  return {
    ...store,
    samples: [
      ...store.samples.map((s) =>
        s.id === originId ? { ...s, supersededBy: copy.id } : s
      ),
      copy,
    ],
    counters: { ...store.counters, sample: store.counters.sample + 1 },
  };
}

/* ---------- 编号 ---------- */

export function nextSampleCode(store: Store, holeId: string): string {
  return `${holeId}-S${String(store.counters.sample + 1).padStart(2, "0")}`;
}

export function nextHandoverCode(store: Store, holeId: string): string {
  return `${holeId}-J${String(store.counters.handover + 1).padStart(2, "0")}`;
}

export function nextRunSeq(store: Store, holeId: string): number {
  const seqs = store.runs.filter((r) => r.holeId === holeId).map((r) => r.seq);
  return seqs.length ? Math.max(...seqs) + 1 : 1;
}
