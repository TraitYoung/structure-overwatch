import type { AnalysisStatus } from '@surv/shared';
import { useWorld } from './store/world';
import { useWorldSync } from './net/useWorldSync';
import { WorldMap } from './map/WorldMap';
import { EventsBar } from './panels/EventsBar';
import { BoundariesPanel } from './panels/BoundariesPanel';
import { DepsPanel } from './panels/DepsPanel';
import { IsoCity } from './iso/IsoCity';

function statusText(status: AnalysisStatus): { label: string; cls: string } {
  switch (status.state) {
    case 'scanning':
      return { label: `勘测中 ${status.filesDone}`, cls: 'st-scanning' };
    case 'watching':
      return { label: '警戒中', cls: 'st-watching' };
    case 'error':
      return { label: '故障', cls: 'st-error' };
  }
}

export function App(): JSX.Element {
  useWorldSync();
  const connected = useWorld((st) => st.connected);
  const repoName = useWorld((st) => st.repoName);
  const status = useWorld((st) => st.status);
  const version = useWorld((st) => st.version);
  const drawer = useWorld((st) => st.drawer);
  const degraded = useWorld((st) => st.degraded);
  const violations = useWorld((st) => st.violations);

  const st = statusText(status);
  const highCount = violations.filter((v) => v.severity === 'high').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◫</span>
          <span className="brand-name">STRUCTURE SURVALLIAN</span>
          <span className="brand-sub">架构哨站</span>
        </div>
        <div className="topbar-center">
          <span className="repo-name">{repoName || '…'}</span>
          <span className={`status-chip ${st.cls}`}>
            {st.label}
          </span>
          {degraded && <span className="status-chip st-degraded">规模超限 · 已降级</span>}
          {highCount > 0 && <span className="status-chip st-high">{highCount} 项高危</span>}
        </div>
        <div className="topbar-right">
          <span className={`ws-dot ${connected ? 'on' : 'off'}`} title={connected ? '事件流已连接' : '事件流断开，重连中'} />
          <span className="version">世界历 {version}</span>
          <button
            className={`tool-btn ${drawer === 'boundaries' ? 'active' : ''}`}
            onClick={() => useWorld.getState().setDrawer(drawer === 'boundaries' ? null : 'boundaries')}
          >
            边界 {violations.length > 0 && <em>{violations.length}</em>}
          </button>
          <button
            className={`tool-btn ${drawer === 'deps' ? 'active' : ''}`}
            onClick={() => useWorld.getState().setDrawer(drawer === 'deps' ? null : 'deps')}
          >
            依赖
          </button>
        </div>
      </header>
      <div className="main">
        <div className="map-area">
          <WorldMap />
        </div>
        {drawer && (
          <aside className="drawer">
            {drawer === 'boundaries' ? <BoundariesPanel /> : <DepsPanel />}
          </aside>
        )}
      </div>
      <EventsBar />
      <IsoCity />
    </div>
  );
}
