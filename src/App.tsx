import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  AppState,
  DrillRun,
  Handover,
  MIN_RECOVERY,
  MissingSegment,
  STORAGE_KEY,
  Sample,
  SampleKind,
  addSample,
  applyHandover,
  calcRecovery,
  correctSample,
  handoverConflicts,
  holeRuns,
  lastRunEnd,
  loadState,
  registerRun,
  round2,
  saveState,
  seedState,
  validateRunDraft,
  validateSampleDraft,
} from "./lib/drilling";

const LITHOLOGIES = [
  "素填土",
  "粉质黏土",
  "黏土",
  "粉土",
  "粉砂",
  "中砂",
  "卵石",
  "强风化泥岩",
  "中风化泥岩",
];

const fmt = (n: number) => n.toFixed(2);
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

interface Banner {
  type: "ok" | "err";
  text: string;
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "watch" | "danger";
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={`status-${tone}`} />
    </article>
  );
}

function SampleBadges({ sample, byId }: { sample: Sample; byId: Map<string, Sample> }) {
  return (
    <span className="badge-group">
      {sample.status === "draft" && <em className="badge badge-draft">待移交</em>}
      {sample.status === "frozen" && <em className="badge badge-frozen">已交班·冻结</em>}
      {sample.supersededBy && (
        <em className="badge badge-superseded">
          已更正 → {byId.get(sample.supersededBy)?.code ?? "副本"}
        </em>
      )}
      {sample.correctionOf && (
        <em className="badge badge-copy">
          更正副本 ← {byId.get(sample.correctionOf)?.code ?? "原记录"}
        </em>
      )}
    </span>
  );
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [holeId, setHoleId] = useState<string>(() => state.holes[0] ?? "");
  const [banner, setBanner] = useState<Banner | null>(null);

  // 回次表单（起始深度强制承接上一回次终点）
  const [endDepth, setEndDepth] = useState("");
  const [lithology, setLithology] = useState("");
  const [coreLength, setCoreLength] = useState("");

  // 取样表单
  const [sampleRunId, setSampleRunId] = useState("");
  const [sampleDepth, setSampleDepth] = useState("");
  const [sampleKind, setSampleKind] = useState<SampleKind>("原状样");
  const [sampleNote, setSampleNote] = useState("");

  // 交班
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fromWho, setFromWho] = useState("");
  const [toWho, setToWho] = useState("");

  // 新增钻孔
  const [newHole, setNewHole] = useState("");

  // 更正副本
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [fixRunId, setFixRunId] = useState("");
  const [fixDepth, setFixDepth] = useState("");
  const [fixKind, setFixKind] = useState<SampleKind>("原状样");
  const [fixReason, setFixReason] = useState("");

  // 任何状态变化即落盘，重新进入页面后完整恢复
  useEffect(() => {
    saveState(state);
  }, [state]);

  const runs = useMemo(() => holeRuns(state, holeId), [state, holeId]);
  const samples = useMemo(
    () =>
      state.samples
        .filter((s) => s.holeId === holeId)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [state, holeId]
  );
  const missing = useMemo(
    () => state.missing.filter((m) => m.holeId === holeId),
    [state, holeId]
  );
  const handovers = useMemo(
    () => state.handovers.filter((h) => h.holeId === holeId),
    [state, holeId]
  );
  const byId = useMemo(
    () => new Map(state.samples.map((s) => [s.id, s])),
    [state.samples]
  );
  const runById = useMemo(
    () => new Map(state.runs.map((r) => [r.id, r])),
    [state.runs]
  );

  const nextStart = lastRunEnd(state, holeId);
  const openMissing = missing.filter((m) => m.status === "open");
  const effectiveSamples = samples.filter((s) => !s.supersededBy);
  const draftSamples = samples.filter((s) => s.status === "draft");
  const correcting = correctingId ? byId.get(correctingId) ?? null : null;

  // 回次进尺与采取率实时预览
  const endNum = parseFloat(endDepth);
  const coreNum = parseFloat(coreLength);
  const advancePreview =
    Number.isFinite(endNum) && endNum > nextStart ? round2(endNum - nextStart) : null;
  const recoveryPreview =
    advancePreview && Number.isFinite(coreNum)
      ? calcRecovery(advancePreview, coreNum)
      : null;

  function switchHole(next: string) {
    setHoleId(next);
    setSelected(new Set());
    setCorrectingId(null);
    setBanner(null);
    setEndDepth("");
    setCoreLength("");
    setLithology("");
    setSampleRunId("");
    setSampleDepth("");
  }

  function submitRun() {
    const draft = {
      holeId,
      startDepth: nextStart,
      endDepth: parseFloat(endDepth),
      lithology,
      coreLength: parseFloat(coreLength),
    };
    const errors = validateRunDraft(state, draft);
    if (errors.length) {
      setBanner({ type: "err", text: errors.join("；") });
      return;
    }
    const { next, result } = registerRun(state, draft);
    setState(next);
    if (result.ok) {
      const covered =
        result.coveredMissing > 0 ? `，同时闭合 ${result.coveredMissing} 段缺失井段` : "";
      setBanner({
        type: "ok",
        text: `回次 ${result.run.seq} 已登记：${fmt(result.run.startDepth)}–${fmt(
          result.run.endDepth
        )}m，进尺 ${fmt(result.run.advance)}m，采取率 ${result.run.recovery}%${covered}`,
      });
    } else {
      setBanner({
        type: "err",
        text: `采取率 ${result.recovery}% 不足 ${MIN_RECOVERY}%，本回次不予登记，井段 ${fmt(
          result.missing.startDepth
        )}–${fmt(result.missing.endDepth)}m 已列入缺失井段，请补钻后重新登记`,
      });
    }
    setEndDepth("");
    setCoreLength("");
  }

  function submitSample() {
    const draft = {
      holeId,
      runId: sampleRunId,
      depth: parseFloat(sampleDepth),
      kind: sampleKind,
      note: sampleNote,
    };
    const errors = validateSampleDraft(state, draft);
    if (errors.length) {
      setBanner({ type: "err", text: errors.join("；") });
      return;
    }
    const { next, sample } = addSample(state, draft);
    setState(next);
    setBanner({ type: "ok", text: `样品 ${sample.code} 已登记，等待移交` });
    setSampleDepth("");
    setSampleNote("");
  }

  function removeDraft(id: string) {
    setState({ ...state, samples: state.samples.filter((s) => s.id !== id) });
    setSelected((prev) => {
      const nextSel = new Set(prev);
      nextSel.delete(id);
      return nextSel;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const nextSel = new Set(prev);
      if (nextSel.has(id)) nextSel.delete(id);
      else nextSel.add(id);
      return nextSel;
    });
  }

  function submitHandover() {
    if (selected.size === 0) {
      setBanner({ type: "err", text: "请先勾选待移交的样品" });
      return;
    }
    if (!fromWho.trim() || !toWho.trim()) {
      setBanner({ type: "err", text: "请填写交班人与接班人" });
      return;
    }
    const ids = [...selected];
    const conflicts = handoverConflicts(state, holeId, ids);
    if (conflicts.length) {
      const detail = conflicts
        .map((c) => `${fmt(c.depth)}m：${c.codes.join("、")}`)
        .join("；");
      setBanner({
        type: "err",
        text: `同孔同深重复取样，移交已阻止（${detail}）。请删除重样或以更正副本调整后再交班`,
      });
      return;
    }
    const { next, handover } = applyHandover(state, holeId, ids, fromWho, toWho);
    setState(next);
    setSelected(new Set());
    setBanner({
      type: "ok",
      text: `${handover.no} 已完成，${ids.length} 件样品交 ${handover.to} 签收并冻结`,
    });
  }

  function openCorrection(sample: Sample) {
    setCorrectingId(sample.id);
    setFixRunId(sample.runId);
    setFixDepth(String(sample.depth));
    setFixKind(sample.kind);
    setFixReason("");
    setBanner(null);
  }

  function submitCorrection() {
    if (!correctingId) return;
    const { next, copy, error } = correctSample(state, correctingId, {
      runId: fixRunId,
      depth: parseFloat(fixDepth),
      kind: fixKind,
      reason: fixReason,
    });
    if (error || !next || !copy) {
      setBanner({ type: "err", text: error ?? "更正失败" });
      return;
    }
    setState(next);
    setCorrectingId(null);
    setBanner({
      type: "ok",
      text: `已生成更正副本 ${copy.code}，原记录保留可查，副本随原交班单一并冻结`,
    });
  }

  function addHole() {
    const name = newHole.trim();
    if (!name) return;
    if (state.holes.includes(name)) {
      setBanner({ type: "err", text: `钻孔 ${name} 已存在` });
      return;
    }
    setState({ ...state, holes: [...state.holes, name] });
    setNewHole("");
    switchHole(name);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `钻孔编录-${holeId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetAll() {
    if (window.confirm("确定清空本地数据并恢复演示数据？")) {
      setState(seedState());
      switchHole(seedState().holes[0]);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-03 · 钻探回次与取样移交闭环</p>
          <h1>岩土钻孔编录</h1>
          <p className="subtitle">
            回次起止深度逐段承接，采取率不足 {MIN_RECOVERY}% 不予登记并列入缺失井段；
            原状样限同一回次内取样，同孔同深重复样品阻止移交；交班后样品冻结，
            更正保留原记录并新建原因副本。全部数据本地落盘，刷新页面不丢失。
          </p>
        </div>
        <div className="stack-card">
          <span>数据落盘</span>
          <strong>localStorage · {STORAGE_KEY}</strong>
          <div className="stack-actions">
            <button onClick={exportJson}>导出 JSON</button>
            <button onClick={resetAll}>重置演示数据</button>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="累计孔深" value={`${fmt(nextStart)} m`} tone="ok" />
        <MetricCard label="已登记回次" value={`${runs.length} 回`} tone="watch" />
        <MetricCard label="有效样品" value={`${effectiveSamples.length} 件`} tone="ok" />
        <MetricCard
          label="缺失井段"
          value={`${openMissing.length} 段`}
          tone={openMissing.length ? "danger" : "ok"}
        />
      </section>

      <section className="panel hole-bar">
        <div className="hole-tabs">
          {state.holes.map((h) => (
            <button
              key={h}
              className={h === holeId ? "active" : ""}
              onClick={() => switchHole(h)}
            >
              {h}
            </button>
          ))}
        </div>
        <div className="hole-add">
          <input
            placeholder="新钻孔编号，如 ZK-30"
            value={newHole}
            onChange={(e) => setNewHole(e.target.value)}
          />
          <button onClick={addHole}>新增钻孔</button>
        </div>
      </section>

      {banner && (
        <p className={`banner banner-${banner.type}`} role="status">
          {banner.text}
        </p>
      )}

      <div className="board">
        <div className="board-col">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>钻进记录</p>
                <h2>回次登记</h2>
              </div>
            </div>
            <div className="field-grid">
              <label>
                <span>起始深度（承接上一回次）</span>
                <input value={`${fmt(nextStart)} m`} readOnly />
              </label>
              <label>
                <span>终止深度（m）</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="如 2.0"
                  value={endDepth}
                  onChange={(e) => setEndDepth(e.target.value)}
                />
              </label>
              <label>
                <span>回次进尺（自动）</span>
                <input
                  value={advancePreview ? `${fmt(advancePreview)} m` : "—"}
                  readOnly
                />
              </label>
              <label>
                <span>主要岩性</span>
                <input
                  list="lithology-list"
                  placeholder="选择或填写岩性"
                  value={lithology}
                  onChange={(e) => setLithology(e.target.value)}
                />
                <datalist id="lithology-list">
                  {LITHOLOGIES.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>岩心采取长度（m）</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="如 1.85"
                  value={coreLength}
                  onChange={(e) => setCoreLength(e.target.value)}
                />
              </label>
              <label>
                <span>采取率（下限 {MIN_RECOVERY}%）</span>
                <input
                  className={
                    recoveryPreview !== null && recoveryPreview < MIN_RECOVERY
                      ? "input-danger"
                      : ""
                  }
                  value={recoveryPreview !== null ? `${recoveryPreview}%` : "—"}
                  readOnly
                />
              </label>
            </div>
            <p className="hint">
              采取率不足 {MIN_RECOVERY}% 的回次不予登记，井段自动列入缺失井段，补钻合格后重新登记。
            </p>
            <button className="primary-action" onClick={submitRun}>
              登记回次
            </button>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>{holeId}</p>
                <h2>回次列表</h2>
              </div>
            </div>
            {runs.length === 0 ? (
              <p className="hint">尚无回次，首个回次自孔口 0.00m 起登记。</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>回次</th>
                    <th>起止深度（m）</th>
                    <th>进尺（m）</th>
                    <th>主要岩性</th>
                    <th>采取率</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r: DrillRun) => (
                    <tr key={r.id}>
                      <td>{r.seq}</td>
                      <td>
                        {fmt(r.startDepth)} – {fmt(r.endDepth)}
                      </td>
                      <td>{fmt(r.advance)}</td>
                      <td>{r.lithology}</td>
                      <td>{r.recovery}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>采取率不足井段</p>
                <h2>缺失井段</h2>
              </div>
            </div>
            {missing.length === 0 ? (
              <p className="hint">当前钻孔无缺失井段。</p>
            ) : (
              <div className="missing-list">
                {missing.map((m: MissingSegment) => (
                  <article
                    key={m.id}
                    className={`missing-item ${
                      m.status === "open" ? "missing-open" : "missing-covered"
                    }`}
                  >
                    <strong>
                      {fmt(m.startDepth)} – {fmt(m.endDepth)} m · {m.lithology}
                    </strong>
                    <p>
                      {m.reason} ·{" "}
                      {m.status === "open"
                        ? "待补钻"
                        : `已补钻闭合（回次 ${
                            runById.get(m.coveredByRunId ?? "")?.seq ?? "?"
                          }）`}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="board-col">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>限同一回次内</p>
                <h2>取样登记</h2>
              </div>
            </div>
            {runs.length === 0 ? (
              <p className="hint">请先登记回次，原状样只能落在已登记回次内。</p>
            ) : (
              <>
                <div className="field-grid">
                  <label>
                    <span>所属回次</span>
                    <select
                      value={sampleRunId}
                      onChange={(e) => setSampleRunId(e.target.value)}
                    >
                      <option value="">请选择回次</option>
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          回次{r.seq} · {fmt(r.startDepth)}–{fmt(r.endDepth)}m ·{" "}
                          {r.lithology}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>取样深度（m）</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="须在所选回次范围内"
                      value={sampleDepth}
                      onChange={(e) => setSampleDepth(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>样品类型</span>
                    <select
                      value={sampleKind}
                      onChange={(e) => setSampleKind(e.target.value as SampleKind)}
                    >
                      <option value="原状样">原状样</option>
                      <option value="扰动样">扰动样</option>
                    </select>
                  </label>
                  <label>
                    <span>备注</span>
                    <input
                      placeholder="封装方式等（可空）"
                      value={sampleNote}
                      onChange={(e) => setSampleNote(e.target.value)}
                    />
                  </label>
                </div>
                <button className="primary-action" onClick={submitSample}>
                  登记样品
                </button>
              </>
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>{holeId} · 勾选待移交样品</p>
                <h2>样品清单</h2>
              </div>
            </div>
            {samples.length === 0 ? (
              <p className="hint">尚无样品。</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>编号</th>
                    <th>回次</th>
                    <th>深度（m）</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.id} className={s.supersededBy ? "row-muted" : ""}>
                      <td>
                        {s.status === "draft" && (
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            aria-label={`选择 ${s.code}`}
                          />
                        )}
                      </td>
                      <td>{s.code}</td>
                      <td>{runById.get(s.runId)?.seq ?? "?"}</td>
                      <td>{fmt(s.depth)}</td>
                      <td>{s.kind}</td>
                      <td>
                        <SampleBadges sample={s} byId={byId} />
                        {s.correctionReason && (
                          <span className="reason">原因：{s.correctionReason}</span>
                        )}
                      </td>
                      <td>
                        {s.status === "draft" && (
                          <button
                            className="link-btn"
                            onClick={() => removeDraft(s.id)}
                          >
                            删除
                          </button>
                        )}
                        {s.status === "frozen" && !s.supersededBy && (
                          <button
                            className="link-btn"
                            onClick={() => openCorrection(s)}
                          >
                            更正
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>交班后样品冻结</p>
                <h2>交班办理</h2>
              </div>
            </div>
            <div className="field-grid">
              <label>
                <span>交班人</span>
                <input
                  placeholder="如 张工"
                  value={fromWho}
                  onChange={(e) => setFromWho(e.target.value)}
                />
              </label>
              <label>
                <span>接班人</span>
                <input
                  placeholder="如 李工"
                  value={toWho}
                  onChange={(e) => setToWho(e.target.value)}
                />
              </label>
            </div>
            <p className="hint">
              已勾选 {selected.size} 件待移交样品（当前孔待移交共 {draftSamples.length}{" "}
              件）。同孔同深重复取样将阻止移交。
            </p>
            <button className="primary-action" onClick={submitHandover}>
              办理交班并冻结
            </button>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>移交留痕</p>
                <h2>交班记录</h2>
              </div>
            </div>
            {handovers.length === 0 ? (
              <p className="hint">尚无交班记录。</p>
            ) : (
              <div className="handover-list">
                {handovers.map((h: Handover) => {
                  const items = samples.filter((s) => s.handoverId === h.id);
                  return (
                    <article key={h.id} className="handover-item">
                      <header>
                        <strong>{h.no}</strong>
                        <span>
                          {h.from} → {h.to} · {fmtTime(h.at)}
                        </span>
                      </header>
                      <ul>
                        {items.map((s) => (
                          <li key={s.id}>
                            {s.code}（{fmt(s.depth)}m · {s.kind}）{" "}
                            <SampleBadges sample={s} byId={byId} />
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {correcting && (
        <div className="modal-backdrop" onClick={() => setCorrectingId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>更正 {correcting.code}（原记录保留）</h2>
            <p className="hint">
              原记录 {correcting.code}（{fmt(correcting.depth)}m · {correcting.kind}
              ）已交班冻结，本次更正将新建带原因的冻结副本。
            </p>
            <div className="field-grid">
              <label>
                <span>所属回次</span>
                <select value={fixRunId} onChange={(e) => setFixRunId(e.target.value)}>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      回次{r.seq} · {fmt(r.startDepth)}–{fmt(r.endDepth)}m
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>更正后深度（m）</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={fixDepth}
                  onChange={(e) => setFixDepth(e.target.value)}
                />
              </label>
              <label>
                <span>样品类型</span>
                <select
                  value={fixKind}
                  onChange={(e) => setFixKind(e.target.value as SampleKind)}
                >
                  <option value="原状样">原状样</option>
                  <option value="扰动样">扰动样</option>
                </select>
              </label>
              <label>
                <span>更正原因（必填）</span>
                <input
                  placeholder="如 取样深度记录笔误"
                  value={fixReason}
                  onChange={(e) => setFixReason(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => setCorrectingId(null)}>取消</button>
              <button className="primary-action" onClick={submitCorrection}>
                生成原因副本
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
