import { useState } from "react";
import { fmt, pendingSamples, validateHandover } from "../domain";
import { applyHandover, nextHandoverCode } from "../store";
import type { Handover, Hole, Sample, Store } from "../types";

interface Props {
  store: Store;
  hole: Hole;
  samples: Sample[];
  handovers: Handover[];
  onChange: (store: Store) => void;
}

type Msg = { kind: "error" | "ok"; text: string } | null;

export function HandoverSection({ store, hole, samples, handovers, onChange }: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  const pending = pendingSamples(samples);

  const submit = () => {
    if (!from.trim() || !to.trim()) {
      setMsg({ kind: "error", text: "请填写交班人和接班人" });
      return;
    }
    const error = validateHandover(samples);
    if (error) {
      setMsg({ kind: "error", text: error });
      return;
    }
    const handover: Handover = {
      id: `hov-${store.counters.handover + 1}`,
      code: nextHandoverCode(store, hole.id),
      holeId: hole.id,
      sampleIds: pending.map((s) => s.id),
      from: from.trim(),
      to: to.trim(),
      note: note.trim() || undefined,
      at: new Date().toISOString(),
    };
    onChange(applyHandover(store, handover));
    setFrom("");
    setTo("");
    setNote("");
    setMsg({
      kind: "ok",
      text: `${handover.code} 已移交 ${handover.sampleIds.length} 件样品，样品已冻结`,
    });
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>交班移交</p>
          <h2>移交与批次 · {hole.id}</h2>
        </div>
        <span className="rule-chip">待移交 {pending.length} 件</span>
      </div>

      <div className="form-grid">
        <label>
          <span>交班人</span>
          <input
            placeholder="如：张工"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span>接班人</span>
          <input
            placeholder="如：李工"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="span-2">
          <span>备注（可选）</span>
          <input
            placeholder="如：晚班接收，样品冷藏保存"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <div className="form-actions">
        <button className="primary-action" onClick={submit}>
          交班移交（冻结 {pending.length} 件）
        </button>
        {msg && <span className={`notice ${msg.kind}`}>{msg.text}</span>}
      </div>

      <div className="record-list">
        {handovers.length === 0 && <p className="empty-text">尚无交班批次</p>}
        {handovers.map((h) => (
          <article key={h.id} className="record-card handover-card">
            <div className="record-index accent">{h.code.split("-").pop()}</div>
            <div>
              <h3>
                {h.code}
                <span className="depth-text">
                  {new Date(h.at).toLocaleString("zh-CN", { hour12: false })}
                </span>
              </h3>
              <p>
                {h.from} → {h.to}
                {h.note ? ` · ${h.note}` : ""} · {h.sampleIds.length} 件样品
              </p>
              <div className="badge-row">
                {h.sampleIds.map((id) => {
                  const s = store.samples.find((x) => x.id === id);
                  if (!s) return null;
                  return (
                    <span
                      key={id}
                      className={`badge ${
                        s.supersededBy
                          ? "badge-superseded"
                          : s.originId
                          ? "badge-copy"
                          : "badge-handed"
                      }`}
                    >
                      {s.code} {fmt(s.depthFrom)}–{fmt(s.depthTo)}m
                      {s.supersededBy ? "（已更正）" : ""}
                      {s.originId ? "（副本）" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
