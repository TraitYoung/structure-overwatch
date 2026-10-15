import { useEffect, useRef, useState } from 'react';
import { useWorld } from '../store/world';

export function ModuleIndex(): JSX.Element {
  const nodes = useWorld((s) => s.nodes);
  const rev = useWorld((s) => s.rev);
  const selected = useWorld((s) => s.selectedModuleId);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLElement>(null);
  const modules = [...nodes.values()].filter((n) => n.kind === 'module').sort((a, b) => a.id.localeCompare(b.id));
  const active = modules.find((m) => m.id === selected);
  const metrics = active?.metrics?.kind === 'module' ? active.metrics : null;
  void rev;
  useEffect(() => {
    listRef.current?.querySelector('.module-row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return <aside className="module-index" aria-label="模块索引">
    <div className="index-heading"><span className="eyebrow">PROJECT INDEX</span><h2>项目索引 <span>{String(modules.length).padStart(2, '0')}</span></h2></div>
    <label className="index-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="查找模块…" aria-label="查找模块" /></label>
    <div className="index-list-heading"><span>编号 / 模块</span><span>文件数</span></div>
    <nav ref={listRef} className="module-list" aria-label="选择模块">
      <button className={`module-row overview-row ${selected === null ? 'selected' : ''}`} onClick={() => useWorld.getState().selectModule(null)}><span className="module-number">◎</span><span>项目总览</span><span className="module-row-count">ALL</span></button>
      {modules.map((m, i) => <button key={m.id} hidden={!`${m.name} ${m.path ?? ''}`.toLowerCase().includes(query.toLowerCase())} className={`module-row ${selected === m.id ? 'selected' : ''}`} onClick={() => useWorld.getState().selectModule(m.id)} aria-pressed={selected === m.id}>
        <span className="module-number">{String(i + 1).padStart(2, '0')}</span><span className="module-row-name" title={m.path || m.name}>{m.name}</span><span className="module-row-count">{m.metrics?.kind === 'module' ? m.metrics.files : '—'}</span>
      </button>)}
      {modules.length === 0 && <p className="index-empty">连接项目后，模块目录将显示在这里。</p>}
      {modules.length > 0 && !modules.some((m) => `${m.name} ${m.path ?? ''}`.toLowerCase().includes(query.toLowerCase())) && <p className="index-empty">没有匹配的模块。</p>}
    </nav>
    <div className="index-detail">
      <span className="eyebrow">{active ? 'MODULE DETAIL' : 'READING THE PLAN'}</span>
      {active ? <><h3>{active.name}</h3><p className="index-path">{active.path || active.id}</p><dl className="module-metrics"><div><dt>健康度</dt><dd className={metrics && metrics.health < 70 ? 'text-warning' : 'text-healthy'}>{metrics?.health ?? '—'}<small> / 100</small></dd></div><div><dt>代码行数</dt><dd>{metrics?.loc.toLocaleString() ?? '—'}</dd></div><div><dt>被依赖 / 依赖</dt><dd>{metrics?.fanIn ?? '—'} / {metrics?.fanOut ?? '—'}</dd></div></dl><button className="detail-open" onClick={() => useWorld.getState().setIsoOpen(true)}>查看模块剖面 <span>↗</span></button></> : <><svg className="index-plan-symbol" viewBox="0 0 160 72" fill="none" aria-hidden="true"><path d="M12 60h136M24 60V30a20 20 0 0 1 40 0v30m32 0V30a20 20 0 0 1 40 0v30M34 60V30a10 10 0 0 1 20 0v30m52 0V30a10 10 0 0 1 20 0v30M8 65h144M80 4v64" stroke="currentColor" strokeWidth=".7"/><path d="M8 30h144" stroke="currentColor" strokeWidth=".5" strokeDasharray="3 4"/></svg><p>选择模块查看指标，双击图中组团进入文件剖面。</p></>}
    </div>
    <div className="index-footnote"><span>STRUCTURE SURVALLIAN</span><span>本地架构观测</span></div>
  </aside>;
}
