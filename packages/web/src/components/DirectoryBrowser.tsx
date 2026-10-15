import { useEffect, useRef, useState } from 'react';
import type { DirectoryListing } from '@surv/shared';
import { browseDirectories } from '../net/projects';

export function DirectoryBrowser({ initialPath, disabled, onOpen, onCancel }: {
  initialPath?: string;
  disabled: boolean;
  onOpen: (path: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const parentButton = useRef<HTMLButtonElement>(null);

  async function navigate(path?: string) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true); setError('');
    try {
      const data = await browseDirectories(path, controller.signal);
      if (!controller.signal.aborted) setListing(data);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取目录。');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void navigate(initialPath);
    return () => activeRequest.current?.abort();
  }, [initialPath]);

  return <section className="directory-browser" aria-label="浏览本地文件夹" aria-busy={loading}>
    <div className="directory-toolbar"><strong>浏览本地文件夹</strong><button type="button" disabled={disabled} onClick={onCancel}>返回路径输入</button></div>
    <p>选择运行架构哨站的电脑上的目录。</p>
    <div className="directory-roots" aria-label="磁盘根目录">{listing?.roots.map((root) => <button key={root} type="button" disabled={loading || disabled} onClick={() => void navigate(root)}>{root}</button>)}</div>
    <div className="directory-location"><button ref={parentButton} type="button" aria-label="上一级目录" disabled={!listing?.parent || loading || disabled} onClick={() => void navigate(listing?.parent ?? undefined)}>↑</button><code title={listing?.path}>{listing?.path || initialPath || '本地目录'}</code></div>
    {error && <div className="project-path-error" role="alert">{error}<button type="button" disabled={disabled} onClick={() => void navigate()}>回到当前项目</button></div>}
    <div className="directory-entries">
      {loading ? <p role="status">正在读取目录…</p> : listing?.directories.length === 0 ? <p>没有子文件夹，可直接打开当前目录。</p> : listing?.directories.map((entry) => <button type="button" key={entry.path} disabled={disabled} onClick={() => { void navigate(entry.path); parentButton.current?.focus(); }} aria-label={`进入 ${entry.name}`}><span aria-hidden="true">▱</span><span>{entry.name}</span><span aria-hidden="true">→</span></button>)}
    </div>
    <div className="project-form-actions"><button type="button" className="project-primary" disabled={loading || disabled || !listing || !!error} onClick={() => listing && onOpen(listing.path)}>{disabled ? '正在打开…' : '打开此文件夹'}</button></div>
  </section>;
}
