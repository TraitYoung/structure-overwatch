import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useWorld } from '../store/world';

interface Project { name: string; path: string }

const examples: Project[] = [
  { name: 'structure-overwatch', path: 'D:\\Repositories\\structure-overwatch' },
  { name: 'commerce-platform', path: 'D:\\Repositories\\commerce-platform' },
  { name: 'design-system', path: 'D:\\Repositories\\design-system' },
];

function FolderIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function ProjectSelect(): JSX.Element {
  const repoName = useWorld((s) => s.repoName);
  const repoRoot = useWorld((s) => s.repoRoot);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [projects, setProjects] = useState<Project[]>(examples);
  const [preview, setPreview] = useState<Project | null>(null);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      searchInput.current?.focus();
    }
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    if (adding) pathInput.current?.focus();
  }, [adding]);

  const current = repoRoot ? { name: repoName || '当前项目', path: repoRoot } : null;
  const all = current ? [current, ...projects.filter((p) => p.path !== current.path)] : projects;
  const filtered = all.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase().trim()));

  function close() {
    setOpen(false);
    setQuery('');
    setAdding(false);
    setError('');
    trigger.current?.focus();
  }

  function select(project: Project) {
    setPreview(project.path === repoRoot ? null : project);
    close();
  }

  function addProject(event: FormEvent) {
    event.preventDefault();
    const clean = path.trim().replace(/^["']|["']$/g, '').replace(/[\\/]+$/, '');
    if (!/^(?:[a-zA-Z]:[\\/]|\/|\\\\[^\\]+\\[^\\]+)/.test(clean)) {
      setError('请输入完整的项目目录，例如 D:\\Repositories\\my-project');
      pathInput.current?.focus();
      return;
    }
    const project = { name: clean.split(/[\\/]/).filter(Boolean).pop() || clean, path: clean };
    setProjects((items) => [project, ...items.filter((p) => p.path !== clean)]);
    setPath('');
    select(project);
  }

  return <>
    <button ref={trigger} className="project-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} title={preview?.path || repoRoot || '选择要查看架构的项目'}>
      <FolderIcon />
      <span className="project-trigger-copy"><small>当前项目{preview ? ' · 预览' : ''}</small><strong>{preview?.name || repoName || '选择项目'}</strong></span>
      <span className="project-chevron" aria-hidden="true">⌄</span>
    </button>

    {preview && <div className="project-preview-note" role="status">
      <span><strong>项目选择预览</strong> 已选择 {preview.name}。后端接入后将加载此目录；当前地图仍为{repoName ? ` ${repoName}` : '原项目'}的数据。</span>
      <button onClick={() => setPreview(null)}>退出预览</button>
    </div>}

    <dialog ref={dialog} className="project-dialog" aria-labelledby="project-dialog-title" onCancel={close} onClose={() => setOpen(false)} onClick={(event) => {
      if (event.target === dialog.current) {
        const rect = dialog.current.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }
    }}>
      <div className="project-dialog-heading">
        <div className="project-heading-icon"><FolderIcon /></div>
        <div><span className="project-eyebrow">Project Directory / 01</span><h2 id="project-dialog-title">选择项目，展开架构</h2></div>
        <button className="project-close" onClick={close} aria-label="关闭项目选择器">×</button>
      </div>
      <p className="project-dialog-intro">从一个目录开始，阅读代码的空间与秩序。</p>
      <div className="project-search"><span aria-hidden="true">⌕</span><input ref={searchInput} aria-label="搜索项目名称或路径" placeholder="搜索项目名称或路径…" value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>ESC</kbd></div>
      <div className="project-section-label"><span>项目目录</span><span>{filtered.length} 个项目 <i>· UI 预览</i></span></div>
      <div className="project-list">
        {filtered.map((project) => {
          const live = project.path === repoRoot;
          const selected = project.path === (preview?.path || repoRoot);
          return <button key={project.path} className={`project-card ${selected ? 'is-selected' : ''}`} onClick={() => select(project)}>
            <span className="project-card-icon"><FolderIcon /></span>
            <span className="project-card-copy"><strong>{project.name}</strong><span title={project.path}>{project.path}</span></span>
            <span className={`project-card-tag ${live ? 'is-live' : ''}`}>{selected ? '已选择' : live ? '当前监控' : '演示'}</span>
            <span className="project-card-arrow" aria-hidden="true">↗</span>
          </button>;
        })}
        {filtered.length === 0 && <div className="project-no-results"><FolderIcon /><strong>没有找到匹配的项目</strong><span>换个关键词，或添加一个新的项目目录。</span></div>}
      </div>
      <div className="project-add-section">
        {adding ? <form onSubmit={addProject}>
          <label htmlFor="project-path">项目文件夹路径</label>
          <p>输入运行架构哨站的电脑上的绝对路径。</p>
          <input ref={pathInput} id="project-path" value={path} onChange={(e) => { setPath(e.target.value); setError(''); }} placeholder="D:\Repositories\my-project" aria-invalid={!!error} aria-describedby={error ? 'project-path-error' : undefined} />
          {error && <div id="project-path-error" className="project-path-error" role="alert">{error}</div>}
          <div className="project-form-actions"><button type="button" className="project-secondary" onClick={() => { setAdding(false); setError(''); }}>取消</button><button type="submit" className="project-primary">预览选择 <span aria-hidden="true">→</span></button></div>
        </form> : <button className="project-add" onClick={() => setAdding(true)}><span className="project-add-plus">＋</span><span><strong>打开项目文件夹</strong><small>添加一个本地项目，探索它的架构</small></span><span aria-hidden="true">→</span></button>}
      </div>
      <footer className="project-dialog-footer"><span className="project-footer-dot" /><span>本地项目 · 支持 TypeScript / JavaScript</span><span className="project-preview-badge">前端预览</span></footer>
    </dialog>
  </>;
}
