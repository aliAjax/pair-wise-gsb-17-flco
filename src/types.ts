/** 钻孔 */
export interface Hole {
  id: string;
  /** 设计孔深 (m) */
  designDepth: number;
  /** 采取率下限 (%)，低于该值不得登记回次 */
  recoveryThreshold: number;
}

/** 钻探回次 */
export interface DrillRun {
  id: string;
  holeId: string;
  /** 回次号（孔内顺序） */
  seq: number;
  /** 起始深度 (m)，必须承接上一回次终点 */
  startDepth: number;
  /** 终止深度 (m) */
  endDepth: number;
  /** 回次进尺 (m)，必须等于 终止深度 - 起始深度 */
  footage: number;
  /** 主要岩性 */
  lithology: string;
  /** 采取率 (%) */
  recovery: number;
  createdAt: string;
}

export type SampleKind = "原状样" | "扰动样" | "岩样";

/** pending=待移交；handed=已交班（冻结） */
export type SampleStatus = "pending" | "handed";

/** 样品（原状样等），深度区间必须完整落在同一回次内 */
export interface Sample {
  id: string;
  /** 显示编号，如 ZK-18-S01 */
  code: string;
  holeId: string;
  runId: string;
  kind: SampleKind;
  /** 取样区间 [depthFrom, depthTo] (m) */
  depthFrom: number;
  depthTo: number;
  status: SampleStatus;
  /** 所属交班批次（已交班时存在） */
  handoverId?: string;
  /** 更正副本指向的原记录 id */
  originId?: string;
  /** 更正原因（仅副本有） */
  correctReason?: string;
  /** 原记录被更正后指向取代它的副本 id */
  supersededBy?: string;
  createdAt: string;
}

/** 交班（移交）批次，交班后批次内样品冻结 */
export interface Handover {
  id: string;
  /** 显示编号，如 ZK-18-J01 */
  code: string;
  holeId: string;
  sampleIds: string[];
  /** 交班人 */
  from: string;
  /** 接班人 */
  to: string;
  note?: string;
  at: string;
}

/** 落盘的整体数据结构 */
export interface Store {
  version: 1;
  holes: Hole[];
  runs: DrillRun[];
  samples: Sample[];
  handovers: Handover[];
  counters: { run: number; sample: number; handover: number };
}
