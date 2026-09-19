import { useState } from "react";
import {
  LITHOLOGIES,
  canDeleteRun,
  expectedStartDepth,
  fmt,
  missingIntervals,
  validateRun,
} from "../domain";
import { appendRun, nextRunSeq, removeRun } from "../store";
import type { Hole, Store } from "../types";

interface Props {
  store: Store;
  hole: Hole;
  runs: import("../types").DrillRun[];
  onChange: (store: Store) => void;
}

type Msg = { kind: "error" | "ok"; text: string } | null;

export function RunSection({ store, hole, runs, onChange }: Props) {
  const start = expectedStartDepth(runs);
  const [endDepth, setEndDepth] = useState("");
  const [footage, setFootage] = useState("");
  const [lithology, setLithology] = useState(LITHOLOGIES[0]);
  const [recovery, setRecovery] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  const gaps = missingIntervals(runs, hole.designDepth);

  const onEndChange = (value: string) => {
    setEndDepth(value);
    const end = Number(value);
    if (value !== "" && Number.isFinite(end)) {
      setFootage(fmt(Math.max(0, end - start)));
    }
  };

  const submit = () => {
    const input = {
      startDepth: start,
      endDepth: Number(endDepth),
      footage: Number(footage),
      lithology,
      recovery: Number(recovery),
    };
    if (endDepth === "" || footage === "" || recovery === "") {
      setMsg({ kind: "error", text: "请完整填写终止深度、回次进尺和采取率" });
      return;
    }
    const error = validateRun(input, runs, hole);
    if (error) {
      setMsg({ kind: "error", text: error });
      return;
    }
    const seq = nextRunSeq(store, hole.id);
    onChange(
      appendRun(store, {
        id: `run-${hole.id}-${seq}`,
        holeId: hole.id,
        seq,
        startDepth: input.startDepth,
        endDepth: input.endDepth,
        footage: input.footage,
        lithology: input.lithology,
        recovery: input.recovery,
        createdAt: new Date().toISOString(),
      })
    );
    setEndDepth("");
    setFootage("");
    setRecovery("");
    setMsg({
      kind: "ok",
      text: `第 ${seq} 回次已登记：${fmt(input.startDepth)}–${fmt(
        input.endDepth
      )}m`,
    });
  };

  const onDelete = (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    const error = canDeleteRun(run, store);
    if (error) {
      setMsg({ kind: "error", text: error });
      return;
    }
    if (!window.confirm(`确认删除第 ${run.seq} 回次？`)) return;
    onChange(removeRun(store, runId));
    setMsg({ kind: "ok", text: `第 ${run.seq} 回次已删除` });
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>钻探回次</p>
          <h2>回次登记 · {hole.id}</h2>
        </div>
        <span className="rule-chip">
          采取率下限 {hole.recoveryThreshold}% · 设计孔深 {fmt(hole.designDepth)}m
        </span>
      </div>

      <div className="form-grid">
        <label>
          <span>回次号</span>
          <input value={`第 ${nextRunSeq(store, hole.id)} 回次`} readOnly />
        </label>
        <label>
          <span>起始深度 (m) · 自动承接上回次终点</span>
          <input value={fmt(start)} readOnly />
        </label>
        <label>
          <span>终止深度 (m)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder={`大于 ${fmt(start)}`}
            value={endDepth}
            onChange={(e) => onEndChange(e.target.value)}
          />
        </label>
        <label>
          <span>回次进尺 (m)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="= 终止 − 起始"
            value={footage}
            onChange={(e) => setFootage(e.target.value)}
          />
        </label>
        <label>
          <span>主要岩性</span>
          <select value={lithology} onChange={(e) => setLithology(e.target.value)}>
            {LITHOLOGIES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          <span>采取率 (%)</span>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            placeholder={`≥ ${hole.recoveryThreshold}`}
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
          />
        </label>
      </div>

      <div className="form-actions">
        <button className="primary-action" onClick={submit}>
          登记回次
        </button>
        {msg && <span className={`notice ${msg.kind}`}>{msg.text}</span>}
      </div>

      <div className="gap-panel">
        <h3>缺失井段（未覆盖）</h3>
        {gaps.length === 0 ? (
          <p className="ok-text">已覆盖至设计孔深，无缺失井段</p>
        ) : (
          <ul className="gap-list">
            {gaps.map(([a, b]) => (
              <li key={`${a}-${b}`}>
                <strong>
                  {fmt(a)} – {fmt(b)} m
                </strong>
                <span>缺失 {fmt(b - a)} m</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {runs.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>回次</th>
                <th>起始 (m)</th>
                <th>终止 (m)</th>
                <th>进尺 (m)</th>
                <th>主要岩性</th>
                <th>采取率</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>第 {r.seq} 回次</td>
                  <td>{fmt(r.startDepth)}</td>
                  <td>{fmt(r.endDepth)}</td>
                  <td>{fmt(r.footage)}</td>
                  <td>{r.lithology}</td>
                  <td>
                    <span
                      className={
                        r.recovery < hole.recoveryThreshold
                          ? "badge badge-danger"
                          : "badge badge-ok"
                      }
                    >
                      {r.recovery}%
                    </span>
                  </td>
                  <td>
                    <button
                      className="link-btn"
                      onClick={() => onDelete(r.id)}
                      title="仅最深且无样品的回次可删除"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
