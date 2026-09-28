import type { Severity, Violation, ViolationType } from '@surv/shared';
import { mapSignals, useWorld } from '../store/world';

const TYPE_LABEL: Record<ViolationType, string> = {
  cycle: '循环',
  layer: '分层',
  'deep-import': '深导入',
  'god-module': '上帝',
  orphan: '孤岛',
  misplaced: '错位',
  megacycle: '熔炉',
  'skip-layer': '跨层',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: '高危',
  medium: '中危',
  low: '提示',
};

function groupBySeverity(violations: Violation[]): Array<{ severity: Severity; items: Violation[] }> {
  const groups: Record<Severity, Violation[]> = { high: [], medium: [], low: [] };
  for (const v of violations) groups[v.severity].push(v);
  return (['high', 'medium', 'low'] as Severity[])
    .filter((s) => groups[s].length > 0)
    .map((s) => ({ severity: s, items: groups[s] }));
}

export function BoundariesPanel(): JSX.Element {
  const violations = useWorld((st) => st.violations);
  const boundariesInfo = useWorld((st) => st.boundariesInfo);

  const onPick = (v: Violation) => {
    mapSignals.flashModules(v.moduleIds);
    const firstModule = v.moduleIds[0];
    if (firstModule) useWorld.getState().selectModule(firstModule);
  };

  const groups = groupBySeverity(violations);

  return (
    <div className="panel boundaries-panel">
      <div className="panel-header">
        <span className="panel-title">边境界约</span>
        <span className="panel-count">{violations.length} 项</span>
      </div>
      <div className="boundaries-meta">
        自定义规则 {boundariesInfo.rulesConfigured} 条 · 上帝模块阈值 fan-in {boundariesInfo.godModuleFanIn}
        {boundariesInfo.configFile ? '' : ' · 默认规则'}
      </div>
      {groups.length === 0 && <div className="panel-empty">边境安宁，无违规记录。</div>}
      {groups.map((g) => (
        <div key={g.severity} className="violation-group">
          <div className={`group-label sev-${g.severity}`}>
            {SEVERITY_LABEL[g.severity]} · {g.items.length}
          </div>
          {g.items.map((v) => (
            <div key={v.id} className="violation-item" onClick={() => onPick(v)}>
              <span className={`type-tag type-${v.type}`}>{TYPE_LABEL[v.type]}</span>
              <span className="violation-title" title={v.detail ?? v.title}>{v.title}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
