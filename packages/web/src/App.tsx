import { useState } from 'react';
import type { AnalysisStatus } from '@surv/shared';
import { useWorld } from './store/world';
import { useWorldSync } from './net/useWorldSync';
import { PlanMap } from './map/PlanMap';
import { WorldMap } from './map/WorldMap';
import { EventsBar } from './panels/EventsBar';
import { BoundariesPanel } from './panels/BoundariesPanel';
import { DepsPanel } from './panels/DepsPanel';
import { IsoCity } from './iso/IsoCity';
import { ProjectSelect } from './components/ProjectSelect';
import { ModuleIndex } from './components/ModuleIndex';

function statusText(status: AnalysisStatus): { label: string; cls: string } {
  switch (status.state) {
    case 'scanning':
      return { label: `勘测中 ${status.filesDone}`, cls: 'st-scanning' };
    case 'watching':
      return { label: '实时观测', cls: 'st-watching' };
    case 'error':
      return { label: '故障', cls: 'st-error' };
  }
}

export function App(): JSX.Element {
  useWorldSync();
  const [mapView, setMapView] = useState<'plan' | 'graph'>('plan');
  const connected = useWorld((st) => st.connected);
  const status = useWorld((st) => st.status);
  const version = useWorld((st) => st.version);
  const drawer = useWorld((st) => st.drawer);
  const degraded = useWorld((st) => st.degraded);
  const violations = useWorld((st) => st.violations);
  const nodes = useWorld((st) => st.nodes);
  const edges = useWorld((st) => st.edges);
  const rev = useWorld((st) => st.rev);
  const repoName = useWorld((st) => st.repoName);
  const repoRoot = useWorld((st) => st.repoRoot);
  const modules = [...nodes.values()].filter((n) => n.kind === 'module');
  const files = [...nodes.values()].filter((n) => n.kind === 'file');
  void rev;

  const st = statusText(status);
  const highCount = violations.filter((v) => v.severity === 'high').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" width="34" height="38" viewBox="0 0 34 38" fill="none" aria-hidden="true"><path d="M3 33h28M5 29h24M8 29V14a9 9 0 0 1 18 0v15M12 29V14a5 5 0 0 1 10 0v15M3 35h28M17 0v38M0 14h34" stroke="currentColor" strokeWidth=".85"/><circle cx="17" cy="14" r="13" stroke="currentColor" strokeWidth=".5" strokeDasharray="2 3"/></svg>
          <span className="brand-copy"><span className="brand-name">Structure Survallian</span><span className="brand-sub">架构哨站 / CODE ARCHITECTURE OBSERVATORY</span></span>
        </div>
        <div className="topbar-center">
          <ProjectSelect />
          <span className={`status-chip ${st.cls}`}>
            {connected ? st.label : '未连接'}
          </span>
          {degraded && <span className="status-chip st-degraded">规模超限 · 已降级</span>}
          {highCount > 0 && <span className="status-chip st-high">{highCount} 项高危</span>}
        </div>
        <div className="topbar-right">
          <span className={`ws-dot ${connected ? 'on' : 'off'}`} title={connected ? '事件流已连接' : '事件流断开，重连中'} />
          <span className="version">REV. {String(version).padStart(3, '0')}</span>
          <button
            className={`tool-btn ${drawer === 'boundaries' ? 'active' : ''}`}
            onClick={() => useWorld.getState().setDrawer(drawer === 'boundaries' ? null : 'boundaries')}
          >
            边界检查 {violations.length > 0 && <em>{violations.length}</em>}
          </button>
          <button
            className={`tool-btn ${drawer === 'deps' ? 'active' : ''}`}
            onClick={() => useWorld.getState().setDrawer(drawer === 'deps' ? null : 'deps')}
          >
            依赖分析
          </button>
        </div>
      </header>
      <div className="workspace">
        <ModuleIndex />
        <section className="drawing-workspace" aria-label="架构图纸">
          <div className="drawing-heading"><div><span className="eyebrow">ARCHITECTURE ATLAS / 总体结构</span><h1>Architecture Plan<span>架构总平面图</span></h1><p title={repoRoot}>{repoName || '等待连接项目'}<span className="heading-divider">/</span><span className="drawing-path">{repoRoot || '选择项目，开始探索代码结构'}</span></p></div><div className="drawing-sheet-number"><span>DRAWING NO.</span><strong>A—01</strong><span>总览 · GENERAL PLAN</span></div></div>
          <div className="drawing-summary"><div><span className="summary-label">模块</span><strong>{modules.length.toString().padStart(2, '0')}</strong><small>MODULES</small></div><div><span className="summary-label">文件</span><strong>{files.length.toString().padStart(2, '0')}</strong><small>FILES</small></div><div><span className="summary-label">依赖</span><strong>{edges.size.toString().padStart(2, '0')}</strong><small>RELATIONS</small></div><div><span className="summary-label">边界问题</span><strong className={violations.length ? 'text-warning' : ''}>{violations.length.toString().padStart(2, '0')}</strong><small>OBSERVATIONS</small></div><span className="summary-note">结构，始于清晰的关系。</span></div>
      <div className="main">
        <div className="map-area">
          <div className="drawing-view-switch" role="group" aria-label="地图视图">
            <button aria-pressed={mapView === 'plan'} onClick={() => setMapView('plan')}>总平面图</button>
            <button aria-pressed={mapView === 'graph'} onClick={() => setMapView('graph')}>图情报 / 自由布局</button>
          </div>
          {mapView === 'plan' ? <PlanMap /> : <WorldMap />}
        </div>
        {drawer && (
          <aside className="drawer">
            {drawer === 'boundaries' ? <BoundariesPanel /> : <DepsPanel />}
          </aside>
        )}
      </div>
      <EventsBar />
        </section>
      </div>
      <footer className="app-footer"><span><span className={`footer-dot ${connected ? 'connected' : ''}`} />{connected ? '本地事件流已连接' : '等待连接本地分析服务'}</span><span>文件单元 / 模块组团 / 有向依赖</span><span>STRUCTURE ATLAS <b>·</b> A—01</span></footer>
      <IsoCity />
    </div>
  );
}
