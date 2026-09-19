import { useState } from "react";
import {
  SAMPLE_KINDS,
  duplicateGroups,
  findContainingRun,
  fmt,
  isDuplicate,
  validateSample,
} from "../domain";
import {
  appendSample,
  applyCorrection,
  nextSampleCode,
  removeSample,
} from "../store";
import type { DrillRun, Hole, Sample, SampleKind, Store } from "../types";

interface Props {
  store: Store;
  hole: Hole;
  runs: DrillRun[];
  samples: Sample[];
  onChange: (store: Store) => void;
}

type Msg = { kind: "error" | "ok"; text: string } | null;

export function SampleSection({ store, hole, runs, samples, onChange }: Props) {
  const [kind, setKind] = useState<SampleKind>("原状样");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);

  const fromNum = Number(from);
  const toNum = Number(to);
  const hitRun =
    from !== "" && to !== "" && Number.isFinite(fromNum) && Number.isFinite(toNum)
      ? findContainingRun(runs, fromNum, toNum)
      : null;

  const submit = () => {
    if (from === "" || to === "") {
      setMsg({ kind: "error", text: "请填写取样深度区间" });
      return;
    }
    const error = validateSample(
      { kind, depthFrom: fromNum, depthTo: toNum },
      runs,
      hole
    );
    if (error) {
      setMsg({ kind: "error", text: error });
      return;
    }
    const run = findContainingRun(runs, fromNum, toNum)!;
    const code = nextSampleCode(store, hole.id);
    const sample: Sample = {
      id: `smp-${store.counters.sample + 1}`,
      code,
      holeId: hole.id,
      runId: run.id,
      kind,
      depthFrom: fromNum,
      depthTo: toNum,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const next = appendSample(store, sample);
    onChange(next);
    setFrom("");
    setTo("");
    const dup = isDuplicate(
      next.samples.filter((s) => s.holeId === hole.id),
      sample
    );
    setMsg(
      dup
        ? {
            kind: "error",
            text: `${code} 已登记，但与既有样品同孔同深，移交前须处理重复`,
          }
        : { kind: "ok", text: `${code} 已登记（第 ${run.seq} 回次内），待移交` }
    );
  };

  const onDelete = (sample: Sample) => {
    if (!window.confirm(`确认删除样品 ${sample.code}？`)) return;
    onChange(removeSample(store, sample.id));
    setMsg({ kind: "ok", text: `${sample.code} 已删除` });
  };

  const dupGroups = duplicateGroups(samples);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>取样登记</p>
          <h2>样品列表 · {hole.id}</h2>
        </div>
        {dupGroups.length > 0 && (
          <span className="rule-chip warn">
            存在 {dupGroups.length} 组同孔同深重复，移交被阻止
          </span>
        )}
      </div>

      <div className="form-grid">
        <label>
          <span>样品类型</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SampleKind)}
          >
            {SAMPLE_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          <span>取样自 (m)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="如 3.00"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span>取样至 (m)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="如 3.30"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          <span>所在回次 · 自动判定</span>
          <input
            value={
              from === "" || to === ""
                ? ""
                : hitRun
                ? `第 ${hitRun.seq} 回次（${fmt(hitRun.startDepth)}–${fmt(
                    hitRun.endDepth
                  )}m）`
                : "不在同一回次内"
            }
            readOnly
          />
        </label>
      </div>

      <div className="form-actions">
        <button className="primary-action" onClick={submit}>
          登记样品
        </button>
        {msg && <span className={`notice ${msg.kind}`}>{msg.text}</span>}
      </div>

      <div className="record-list">
        {samples.length === 0 && <p className="empty-text">尚未登记样品</p>}
        {samples.map((s) => (
          <SampleCard
            key={s.id}
            sample={s}
            store={store}
            hole={hole}
            runs={runs}
            samples={samples}
            duplicated={isDuplicate(samples, s)}
            correcting={correctingId === s.id}
            onToggleCorrect={() =>
              setCorrectingId(correctingId === s.id ? null : s.id)
            }
            onDelete={() => onDelete(s)}
            onChange={(next, text) => {
              onChange(next);
              setCorrectingId(null);
              setMsg({ kind: "ok", text });
            }}
          />
        ))}
      </div>
    </section>
  );
}

interface CardProps {
  sample: Sample;
  store: Store;
  hole: Hole;
  runs: DrillRun[];
  samples: Sample[];
  duplicated: boolean;
  correcting: boolean;
  onToggleCorrect: () => void;
  onDelete: () => void;
  onChange: (store: Store, text: string) => void;
}

function SampleCard({
  sample: s,
  store,
  hole,
  runs,
  samples,
  duplicated,
  correcting,
  onToggleCorrect,
  onDelete,
  onChange,
}: CardProps) {
  const [newFrom, setNewFrom] = useState(String(s.depthFrom));
  const [newTo, setNewTo] = useState(String(s.depthTo));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = runs.find((r) => r.id === s.runId);
  const handover = s.handoverId
    ? store.handovers.find((h) => h.id === s.handoverId)
    : undefined;
  const origin = s.originId
    ? store.samples.find((x) => x.id === s.originId)
    : undefined;
  const successor = s.supersededBy
    ? store.samples.find((x) => x.id === s.supersededBy)
    : undefined;
  const superseded = !!s.supersededBy;

  const submitCorrection = () => {
    const depthFrom = Number(newFrom);
    const depthTo = Number(newTo);
    if (!reason.trim()) {
      setError("请填写更正原因");
      return;
    }
    const err = validateSample(
      { kind: s.kind, depthFrom, depthTo },
      runs,
      hole
    );
    if (err) {
      setError(err);
      return;
    }
    const containing = findContainingRun(runs, depthFrom, depthTo)!;
    const copy: Sample = {
      id: `smp-${store.counters.sample + 1}`,
      code: nextSampleCode(store, hole.id),
      holeId: hole.id,
      runId: containing.id,
      kind: s.kind,
      depthFrom,
      depthTo,
      status: "pending",
      originId: s.id,
      correctReason: reason.trim(),
      createdAt: new Date().toISOString(),
    };
    onChange(
      applyCorrection(store, s.id, copy),
      `已保留原记录 ${s.code}，并建立更正副本 ${copy.code}（待移交）`
    );
  };

  return (
    <article className={`record-card sample-card ${superseded ? "dimmed" : ""}`}>
      <div className="record-index">{s.code.split("-").pop()}</div>
      <div className="sample-body">
        <h3>
          {s.code} · {s.kind}
          <span className="depth-text">
            {fmt(s.depthFrom)}–{fmt(s.depthTo)}m
          </span>
        </h3>
        <p>
          {run ? `第 ${run.seq} 回次（${run.lithology}）` : "回次已删除"}
          {handover && ` · ${handover.code} ${handover.from}→${handover.to}`}
        </p>
        <div className="badge-row">
          {superseded && (
            <span className="badge badge-superseded">
              已被 {successor?.code ?? "副本"} 更正取代
            </span>
          )}
          {!superseded && s.status === "handed" && (
            <span className="badge badge-handed">已交班 · 冻结</span>
          )}
          {!superseded && s.status === "pending" && (
            <span className="badge badge-pending">待移交</span>
          )}
          {s.originId && (
            <span className="badge badge-copy">
              副本 · 更正自 {origin?.code ?? "原记录"}：{s.correctReason}
            </span>
          )}
          {duplicated && !superseded && (
            <span className="badge badge-danger">同孔同深重复</span>
          )}
        </div>

        {correcting && (
          <div className="inline-form">
            <div className="form-grid">
              <label>
                <span>更正后取样自 (m)</span>
                <input
                  type="number"
                  step="0.01"
                  value={newFrom}
                  onChange={(e) => setNewFrom(e.target.value)}
                />
              </label>
              <label>
                <span>更正后取样至 (m)</span>
                <input
                  type="number"
                  step="0.01"
                  value={newTo}
                  onChange={(e) => setNewTo(e.target.value)}
                />
              </label>
              <label className="span-2">
                <span>更正原因（必填，原记录保留）</span>
                <input
                  placeholder="如：现场复测深度应为 3.10–3.40m"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="primary-action" onClick={submitCorrection}>
                生成更正副本
              </button>
              <button onClick={onToggleCorrect}>取消</button>
              {error && <span className="notice error">{error}</span>}
            </div>
          </div>
        )}
      </div>
      <div className="sample-actions">
        {!superseded && s.status === "pending" && (
          <button className="link-btn" onClick={onDelete}>
            删除
          </button>
        )}
        {!superseded && s.status === "handed" && !correcting && (
          <button className="link-btn" onClick={onToggleCorrect}>
            更正
          </button>
        )}
      </div>
    </article>
  );
}
