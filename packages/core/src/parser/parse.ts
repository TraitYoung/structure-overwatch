import { existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import type { EdgeKind } from '@surv/shared';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

export function isSourcePath(p: string): boolean {
  if (p.endsWith('.d.ts')) return false;
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  return SOURCE_EXTS.has(p.slice(dot).toLowerCase());
}

/** 仓库相对 posix 路径；不在仓库内时返回 null */
export function toRepoRel(repoRoot: string, absPath: string): string | null {
  const rel = relative(repoRoot, absPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split('\\').join('/');
}

export interface ParsedImport {
  /** 内部：仓库相对 posix 路径；外部：npm 包名 */
  to: string;
  kind: EdgeKind;
  external: boolean;
}

export interface ParsedFile {
  path: string;
  loc: number;
  complexity: number;
  imports: ParsedImport[];
}

function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('node:')) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? parts.slice(0, 2).join('/') : null;
  }
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const name = specifier.split('/')[0];
  return name || null;
}

/** 基于 ts-morph 的 TS/JS 文件解析器：提取行数、近似圈复杂度与 import/re-export 边 */
export class RepoParser {
  private project: Project;

  constructor(private repoRoot: string) {
    const tsconfigPath = join(repoRoot, 'tsconfig.json');
    const hasTsconfig = existsSync(tsconfigPath);
    this.project = new Project({
      ...(hasTsconfig ? { tsConfigFilePath: tsconfigPath } : {}),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: false,
      compilerOptions: hasTsconfig ? {} : { allowJs: true },
    });
  }

  /** 新增文件并解析；文件不存在返回 null */
  addFile(absPath: string): ParsedFile | null {
    if (!isSourcePath(absPath)) return null;
    const sf = this.project.addSourceFileAtPathIfExists(absPath);
    return sf ? this.parse(sf) : null;
  }

  /** 文件内容变化后刷新并重新解析 */
  updateFile(absPath: string): ParsedFile | null {
    if (!isSourcePath(absPath)) return null;
    const existing = this.project.getSourceFile(absPath);
    if (existing) {
      try {
        existing.refreshFromFileSystemSync();
      } catch {
        return null; // 文件可能在刷新间隙被删除
      }
      return this.parse(existing);
    }
    return this.addFile(absPath);
  }

  removeFile(absPath: string): void {
    const sf = this.project.getSourceFile(absPath);
    if (sf) this.project.removeSourceFile(sf);
  }

  private parse(sf: SourceFile): ParsedFile {
    const path = toRepoRel(this.repoRoot, sf.getFilePath());
    if (!path) throw new Error(`文件不在仓库内: ${sf.getFilePath()}`);
    const imports: ParsedImport[] = [];
    this.collectImports(sf, imports);
    return { path, loc: sf.getEndLineNumber(), complexity: this.complexityOf(sf), imports };
  }

  private collectImports(sf: SourceFile, out: ParsedImport[]): void {
    const push = (decl: {
      getModuleSpecifierValue(): string | undefined;
      getModuleSpecifierSourceFile(): SourceFile | undefined;
      isTypeOnly(): boolean;
    }) => {
      const spec = decl.getModuleSpecifierValue();
      if (!spec) return;
      const typeOnly = decl.isTypeOnly();
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) {
        const rel = toRepoRel(this.repoRoot, resolved.getFilePath());
        if (rel && rel !== toRepoRel(this.repoRoot, sf.getFilePath())) {
          out.push({ to: rel, kind: typeOnly ? 'type-import' : 'import', external: false });
          return;
        }
      }
      if (spec.startsWith('.') || spec.startsWith('/')) return; // 解析失败的相对导入，忽略
      const pkg = packageNameOf(spec);
      if (pkg) out.push({ to: pkg, kind: 'external', external: true });
    };

    for (const decl of sf.getImportDeclarations()) push(decl);
    for (const decl of sf.getExportDeclarations()) {
      if (decl.getModuleSpecifierValue()) push(decl);
    }
  }

  /** 近似圈复杂度：分支/循环/case/catch/三元 + 逻辑短路运算符 */
  private complexityOf(sf: SourceFile): number {
    let c = 1;
    const branchKinds = [
      SyntaxKind.IfStatement,
      SyntaxKind.ForStatement,
      SyntaxKind.ForOfStatement,
      SyntaxKind.ForInStatement,
      SyntaxKind.WhileStatement,
      SyntaxKind.DoStatement,
      SyntaxKind.CaseClause,
      SyntaxKind.CatchClause,
      SyntaxKind.ConditionalExpression,
    ];
    for (const kind of branchKinds) c += sf.getDescendantsOfKind(kind).length;
    for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const op = bin.getOperatorToken().getKind();
      if (
        op === SyntaxKind.AmpersandAmpersandToken ||
        op === SyntaxKind.BarBarToken ||
        op === SyntaxKind.QuestionQuestionToken
      ) {
        c += 1;
      }
    }
    return c;
  }
}
