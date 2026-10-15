import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useWorld } from '../store/world';
import { loadProjects, openProject } from '../net/projects';
import { DirectoryBrowser } from './DirectoryBrowser';

interface Project { name: string; path: string }

function FolderIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function PlanIcon() {
  return <svg width="38" height="34" viewBox="0 0 38 34" fill="none" aria-hidden="true">
    <path d="M22 30h12V3H4v27h11M22 28h10V5H6v23h9M6 14h26M21 5v9M15 14v14M22 30v-7a7 7 0 0 0-7 7" stroke="currentColor" strokeWidth=".8" />
    <path d="M1 17h7m22 0h7M19 0v6m0 24v4" stroke="currentColor" strokeWidth=".5" opacity=".5" />
  </svg>;
}

function IndexArrow() {
  return <svg width="23" height="12" viewBox="0 0 23 12" fill="none" aria-hidden="true"><path d="M1 6h20m-5-4 5 4-5 4" stroke="currentColor" strokeWidth=".85" /></svg>;
}

export function ProjectSelect(): JSX.Element {
  const repoName = useWorld((s) => s.repoName);
  const repoRoot = useWorld((s) => s.repoRoot);
  const sessionId = useWorld((s) => s.sessionId);
  const status = useWorld((s) => s.status);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const projectList = useRef<HTMLDivElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [historyWarning, setHistoryWarning] = useState('');
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    void loadProjects(controller.signal).then((list) => {
      if (controller.signal.aborted) return;
      setProjects(list.projects);
      setHistoryWarning(list.historyWarning || '');
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError('无法读取项目索引，请检查本地服务连接或重新打开选择器。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, sessionId]);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      searchInput.current?.focus();
    }
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    if (adding && !browsing) pathInput.current?.focus();
  }, [adding, browsing]);

  useEffect(() => {
    if (error && !openingPath && adding && !browsing) pathInput.current?.focus();
  }, [error, openingPath, adding, browsing]);

  const current: Project | null = repoRoot ? { name: repoName || '当前项目', path: repoRoot } : null;
  const all = current ? [current, ...projects.filter((p) => p.path !== current.path)] : projects;
  const filtered = all.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase().trim()));

  function close() {
    if (openingPath) return;
    setOpen(false);
    setQuery('');
    setAdding(false);
    setError('');
    setBrowsing(false);
    setPath('');
    trigger.current?.focus();
  }

  async function select(project: Project) {
    if (openingPath) return;
    setOpeningPath(project.path); setError('');
    try {
      await openProject(project.path);
      setOpen(false); setAdding(false); setBrowsing(false); setPath(''); setQuery('');
      trigger.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法打开项目，请检查本地服务连接。');
    } finally { setOpeningPath(null); }
  }

  function addProject(event: FormEvent) {
    event.preventDefault();
    const clean = path.trim().replace(/^["']|["']$/g, '');
    if (!/^(?:[a-zA-Z]:[\\/]|\/|\\\\[^\\]+\\[^\\]+)/.test(clean)) {
      setError('请输入完整的项目目录，例如 D:\\Repositories\\my-project');
      pathInput.current?.focus();
      return;
    }
    const project = { name: clean.split(/[\\/]/).filter(Boolean).pop() || clean, path: clean };
    void select(project);
  }

  return <>
    <button ref={trigger} className="project-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} title={repoRoot || '选择要查看架构的项目'}>
      <FolderIcon />
      <span className="project-trigger-copy"><small>当前项目</small><strong>{repoName || '选择项目'}</strong></span>
      <span className="project-chevron" aria-hidden="true">⌄</span>
    </button>

    <dialog ref={dialog} className={`project-dialog ${adding ? 'is-adding' : ''}`} aria-labelledby="project-dialog-title" aria-busy={!!openingPath} onCancel={(event) => { if (openingPath) event.preventDefault(); else close(); }} onClose={() => setOpen(false)} onClick={(event) => {
      if (event.target === dialog.current) {
        const rect = dialog.current.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }
    }}>
      <div className="project-dialog-heading">
        <div><span className="project-eyebrow">PROJECT INDEX</span><h2 id="project-dialog-title">选择项目</h2></div>
        <div className="project-sheet-id" aria-label="图纸编号 P—01"><span>DRAWING NO.</span><strong>P—01</strong><span>项目图纸索引</span></div>
        <button className="project-close" disabled={!!openingPath} onClick={close} aria-label="关闭项目选择器">×</button>
      </div>
      <p className="project-dialog-intro">选择一个项目，展开它的架构。</p>
      <div className="project-search"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" /><path d="m13 13 4 4" stroke="currentColor" /></svg><input ref={searchInput} aria-label="搜索项目名称或路径" placeholder="搜索项目名称或路径" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'ArrowDown' && filtered.length) { e.preventDefault(); projectList.current?.querySelector('button')?.focus(); }
      }} />{query && <button className="project-search-clear" aria-label="清除搜索" onClick={() => { setQuery(''); searchInput.current?.focus(); }}>×</button>}<kbd>ESC</kbd></div>
      <div className="project-section-label"><span>项目目录 <small>/ DIRECTORY</small></span><span role="status" aria-live="polite">{String(filtered.length).padStart(2, '0')} 个项目</span></div>
      <div ref={projectList} className="project-list" aria-label="项目目录列表" onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const rows = Array.from(e.currentTarget.querySelectorAll('button'));
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
        rows[next]?.focus();
      }}>
        {filtered.map((project) => {
          const live = project.path === repoRoot;
          const selected = live;
          return <button key={project.path} disabled={!!openingPath} className={`project-card ${selected ? 'is-selected' : ''}`} onClick={() => void select(project)} aria-pressed={selected}>
            <span className="project-row-index" aria-hidden="true">{String(all.findIndex((p) => p.path === project.path) + 1).padStart(2, '0')}</span>
            <span className="project-card-icon"><PlanIcon /></span>
            <span className="project-card-copy"><strong>{project.name}</strong><span title={project.path}>{project.path}</span></span>
            <span className={`project-card-tag ${live ? 'is-live' : ''}`}><i />{openingPath === project.path ? '打开中…' : live ? status.state === 'scanning' ? '扫描中' : status.state === 'error' ? '扫描失败' : '当前项目' : '最近打开'}</span>
            <span className="project-card-arrow"><IndexArrow /></span>
          </button>;
        })}
        {filtered.length === 0 && <div className="project-no-results"><FolderIcon /><strong>{loading ? '正在读取项目索引…' : query ? '没有找到匹配的项目' : '还没有最近项目'}</strong><span>可以打开一个本地项目文件夹。</span></div>}
      </div>
      {loadError && <p className="project-path-error" role="alert">{loadError}</p>}
      {historyWarning && <p className="project-history-warning" role="status">{historyWarning}</p>}
      {error && <div id="project-path-error" className="project-path-error" role="alert">{error}</div>}
      {openingPath && <p className="project-opening" role="status">正在打开项目并准备架构图，请稍候…</p>}
      <div className="project-add-section">
        {adding ? browsing ? <DirectoryBrowser initialPath={repoRoot || undefined} disabled={!!openingPath} onCancel={() => setBrowsing(false)} onOpen={(selectedPath) => void select({ name: selectedPath.split(/[\\/]/).filter(Boolean).pop() || selectedPath, path: selectedPath })} /> : <form onSubmit={addProject}>
          <label htmlFor="project-path">项目文件夹路径</label>
          <p>输入运行架构哨站的电脑上的绝对路径。</p>
          <input ref={pathInput} id="project-path" disabled={!!openingPath} value={path} onChange={(e) => { setPath(e.target.value); setError(''); }} placeholder="D:\Repositories\my-project" aria-invalid={!!error} aria-describedby={error ? 'project-path-error' : undefined} />
          <div className="project-form-actions"><button type="button" className="project-secondary" disabled={!!openingPath} onClick={() => { setAdding(false); setError(''); searchInput.current?.focus(); }}>取消</button><button type="button" className="project-secondary" disabled={!!openingPath} onClick={() => { setBrowsing(true); setError(''); }}>浏览目录…</button><button type="submit" className="project-primary" disabled={!!openingPath}>{openingPath ? '正在打开…' : '打开并分析'} <span aria-hidden="true">→</span></button></div>
        </form> : <button className="project-add" disabled={!!openingPath} onClick={() => setAdding(true)}><span className="project-add-plus" aria-hidden="true">＋</span><span><strong>打开项目文件夹</strong><small>添加本地目录，建立新的项目索引</small></span><IndexArrow /></button>}
      </div>
      <footer className="project-dialog-footer"><span>LOCAL WORKSPACE <b>·</b> TS / JS</span><span className="project-preview-badge">本地分析</span><span className="project-footer-shortcut"><kbd>↑ ↓</kbd> 浏览 <kbd>↵</kbd> 打开</span></footer>
    </dialog>
  </>;
}
