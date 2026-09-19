import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { HandoverSection } from "./components/HandoverSection";
import { RunSection } from "./components/RunSection";
import { SampleSection } from "./components/SampleSection";
import {
  expectedStartDepth,
  fmt,
  holeHandovers,
  holeRuns,
  holeSamples,
  missingIntervals,
  pendingSamples,
} from "./domain";
import { isValidStore, loadStore, saveStore, seedStore } from "./store";
import type { Store } from "./types";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "岩土钻孔编录",
  subtitle:
    "钻探回次连续承接、采取率门槛、原状样同回次约束与交班冻结的现场编录闭环",
  stack: "React + Vite + TypeScript + CSS",
  domain: "岩土工程",
  users: ["岩土工程师", "现场编录员", "项目负责人"],
};

function MetricCard({
  label,
  value,
  index,
}: {
  label: string;
  value: string;
  index: number;
}) {
  const colors = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [holeId, setHoleId] = useState(() => loadStore().holes[0].id);
  const [toolbarMsg, setToolbarMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 任何变更立即落盘，重新进入页面后数据完整恢复
  useEffect(() => {
    saveStore(store);
  }, [store]);

  const hole = store.holes.find((h) => h.id === holeId) ?? store.holes[0];
  const runs = holeRuns(store, hole.id);
  const samples = holeSamples(store, hole.id);
  const handovers = holeHandovers(store, hole.id);
  const gaps = missingIntervals(runs, hole.designDepth);
  const pending = pendingSamples(samples);

  const metrics = [
    { label: "累计进尺", value: `${fmt(expectedStartDepth(runs))}m` },
    { label: "回次数量", value: String(runs.length) },
    { label: "待移交样品", value: String(pending.length) },
    { label: "已交班批次", value: String(handovers.length) },
  ];

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `borehole-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToolbarMsg("已导出 JSON 备份文件");
  };

  const importJson = (file: File) => {
    file
      .text()
      .then((text) => {
        const parsed: unknown = JSON.parse(text);
        if (!isValidStore(parsed)) {
          setToolbarMsg("导入失败：文件结构不符合编录数据格式");
          return;
        }
        if (!window.confirm("导入将覆盖当前全部编录数据，确认继续？")) return;
        setStore(parsed);
        setHoleId(parsed.holes[0]?.id ?? "");
        setToolbarMsg("导入成功，回次、样品、交班与副本关系已恢复");
      })
      .catch(() => setToolbarMsg("导入失败：不是有效的 JSON 文件"));
  };

  const resetAll = () => {
    if (!window.confirm("确认清空并恢复为示例数据？")) return;
    const seed = seedStore();
    setStore(seed);
    setHoleId(seed.holes[0].id);
    setToolbarMsg("已恢复为示例数据");
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
          <span>数据落盘</span>
          <strong>localStorage 实时保存 · JSON 导入导出</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={i} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>钻孔</h2>
          <div className="chips">
            {store.holes.map((h) => (
              <button
                key={h.id}
                className={h.id === hole.id ? "chip-active" : ""}
                onClick={() => setHoleId(h.id)}
              >
                {h.id}
              </button>
            ))}
          </div>

          <h2>角色</h2>
          <div className="chips muted">
            {project.users.map((u) => (
              <span key={u}>{u}</span>
            ))}
          </div>

          <h2>编录规则</h2>
          <ul className="rule-list">
            <li>回次起点必须承接上一回次终点</li>
            <li>采取率 ≥ {hole.recoveryThreshold}% 方可登记</li>
            <li>原状样必须完整落在同一回次内</li>
            <li>同孔同深重复取样阻止移交</li>
            <li>交班后样品冻结，更正生成原因副本</li>
          </ul>

          <h2>缺失井段</h2>
          {gaps.length === 0 ? (
            <p className="ok-text">无缺失，已覆盖至设计孔深</p>
          ) : (
            <ul className="gap-list compact">
              {gaps.map(([a, b]) => (
                <li key={`${a}-${b}`}>
                  <strong>
                    {fmt(a)}–{fmt(b)}m
                  </strong>
                  <span>{fmt(b - a)}m</span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <RunSection store={store} hole={hole} runs={runs} onChange={setStore} />
      </section>

      <SampleSection
        store={store}
        hole={hole}
        runs={runs}
        samples={samples}
        onChange={setStore}
      />

      <HandoverSection
        store={store}
        hole={hole}
        samples={samples}
        handovers={handovers}
        onChange={setStore}
      />

      <section className="panel toolbar">
        <div>
          <h2>数据落盘</h2>
          <p className="empty-text">
            所有变更实时写入 localStorage；可导出 JSON 存档，或导入备份恢复现场数据。
          </p>
          {toolbarMsg && <span className="notice ok">{toolbarMsg}</span>}
        </div>
        <div className="toolbar-actions">
          <button onClick={exportJson}>导出 JSON</button>
          <button onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <button className="danger-btn" onClick={resetAll}>
            重置为示例数据
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
        </div>
      </section>
    </main>
  );
}

export default App;
