// 六边形世界布局：每个文件占一格，按模块聚合成"省份"。
// 布局确定性且稳定：已存在的文件保持格子不变，新文件只追加到省份外围。

export interface Axial {
  q: number;
  r: number;
}

export const HEX_SIZE = 17; // 世界单位（渲染时再乘缩放）

/** pointy-top 六个邻居：与六边形边 k（corner k → corner k+1）一一对应 */
export const HEX_DIRS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export function hexKey(h: Axial): string {
  return `${h.q},${h.r}`;
}

export function hexAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** 半径 radius 的环（中心距离恰为 radius 的格子），从北西角起顺时针 */
function ring(radius: number): Axial[] {
  if (radius === 0) return [{ q: 0, r: 0 }];
  const results: Axial[] = [];
  let hex: Axial = { q: 0, r: -radius };
  for (const dir of HEX_DIRS) {
    for (let i = 0; i < radius; i++) {
      results.push(hex);
      hex = hexAdd(hex, dir);
    }
  }
  return results;
}

/** 由内到外的螺旋格子序列 */
export function spiral(maxRadius: number): Axial[] {
  const out: Axial[] = [];
  for (let r = 0; r <= maxRadius; r++) out.push(...ring(r));
  return out;
}

/** 容纳 n 个文件所需的最小半径 */
export function radiusFor(count: number): number {
  let r = 0;
  while (1 + 3 * r * (r + 1) < count) r += 1;
  return r;
}

export interface ProvinceLayout {
  moduleId: string;
  name: string;
  origin: Axial;
  radius: number;
  /** 省份全部格子（世界坐标 = origin + cell） */
  cells: Axial[];
  center: Axial;
}

export interface MapLayout {
  provinces: Map<string, ProvinceLayout>;
  cellToFile: Map<string, string>;
  fileToCell: Map<string, Axial>;
  /** 每个省份实际占用的文件数 */
  fileCount: Map<string, number>;
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number };
}

export interface LayoutModuleInput {
  moduleId: string;
  name: string;
  /** 仓库相对路径，已排序 */
  files: string[];
}

/** 单行最大跨度（格子数），超出则换行 */
const WRAP_Q = 52;

/**
 * 计算（或增量更新）地图布局。
 * 传入 prev 时：沿用已有文件的格子与省份原点，只把新文件追加到螺旋空位上。
 * 新省份按行排布（超出 WRAP_Q 换行），行内/行间留白，保证互不重叠。
 */
export function computeLayout(modules: readonly LayoutModuleInput[], prev?: MapLayout): MapLayout {
  const provinces = new Map<string, ProvinceLayout>();
  const cellToFile = new Map<string, string>();
  const fileToCell = new Map<string, Axial>();
  const fileCount = new Map<string, number>();

  // 新省份的排布游标（基于已放置省份与 prev 边界，保证新增不与现有重叠）
  let rowMaxEdge = prev ? prev.bounds.maxQ : 0; // 当前行最右沿（origin.q + radius）
  let rowBaseR = prev ? prev.bounds.maxR : 0;   // 当前行 r 基线
  let rowMaxRadius = 0;                          // 当前行最大省份半径

  for (const mod of modules) {
    const prevProvince = prev?.provinces.get(mod.moduleId);
    let origin: Axial;
    if (prevProvince) {
      origin = prevProvince.origin;
    } else {
      const R = radiusFor(Math.max(mod.files.length, 1));
      if (rowMaxEdge > 0 && rowMaxEdge + R + 2 > WRAP_Q) {
        // 换行：新省份顶沿 = 当前行底沿 + 间距
        rowBaseR = rowBaseR + rowMaxRadius + R + 2;
        rowMaxEdge = 0;
        rowMaxRadius = 0;
      }
      origin = { q: rowMaxEdge + R + 2, r: rowBaseR };
      rowMaxEdge = origin.q + R;
      rowMaxRadius = Math.max(rowMaxRadius, R);
    }

    const radius = radiusFor(Math.max(mod.files.length, 1));
    const cells = spiral(radius).map((c) => hexAdd(origin, c));
    const cellSet = new Set(cells.map(hexKey));

    // 1) 沿用旧布局中仍然有效的格子
    const assigned = new Map<string, Axial>(); // fileId -> cell（相对 origin）
    const occupied = new Set<string>();
    if (prev) {
      for (const file of mod.files) {
        const cell = prev.fileToCell.get(file);
        if (!cell) continue;
        const key = hexKey(cell);
        if (!cellSet.has(key) || occupied.has(key) || cellToFile.has(key)) continue;
        assigned.set(file, cell);
        occupied.add(key);
      }
    }

    // 2) 新文件按螺旋顺序填空位
    const spiralCells = spiral(radius);
    let cursor = 0;
    for (const file of mod.files) {
      if (assigned.has(file)) continue;
      while (cursor < spiralCells.length && occupied.has(hexKey(spiralCells[cursor]))) cursor += 1;
      const cell = spiralCells[cursor] ?? { q: 0, r: 0 };
      cursor += 1;
      assigned.set(file, cell);
      occupied.add(hexKey(cell));
    }

    const province: ProvinceLayout = {
      moduleId: mod.moduleId,
      name: mod.name,
      origin,
      radius,
      cells,
      center: origin,
    };
    provinces.set(mod.moduleId, province);

    let count = 0;
    for (const [file, cell] of assigned) {
      const world = hexAdd(origin, cell);
      cellToFile.set(hexKey(world), file);
      fileToCell.set(file, world);
      count += 1;
    }
    fileCount.set(mod.moduleId, count);
  }

  // 计算包围盒
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const p of provinces.values()) {
    for (const c of p.cells) {
      minQ = Math.min(minQ, c.q);
      maxQ = Math.max(maxQ, c.q);
      minR = Math.min(minR, c.r);
      maxR = Math.max(maxR, c.r);
    }
  }
  if (!Number.isFinite(minQ)) {
    minQ = minR = 0;
    maxQ = maxR = 0;
  }

  return { provinces, cellToFile, fileToCell, fileCount, bounds: { minQ, maxQ, minR, maxR } };
}

function boundsOf(provinces: Map<string, ProvinceLayout>): MapLayout['bounds'] {
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const p of provinces.values()) {
    for (const c of p.cells) {
      minQ = Math.min(minQ, c.q);
      maxQ = Math.max(maxQ, c.q);
      minR = Math.min(minR, c.r);
      maxR = Math.max(maxR, c.r);
    }
  }
  if (!Number.isFinite(minQ)) return { minQ: 0, maxQ: 0, minR: 0, maxR: 0 };
  return { minQ, maxQ, minR, maxR };
}

/**
 * 把省份移动到新原点（吸附六边形网格）。省份是刚体：任何格子压到其他省份即拒绝，返回 null。
 * 移动成功返回全新布局，原布局不被修改。
 */
export function moveProvince(layout: MapLayout, moduleId: string, newOrigin: Axial): MapLayout | null {
  const province = layout.provinces.get(moduleId);
  if (!province) return null;
  const dq = newOrigin.q - province.origin.q;
  const dr = newOrigin.r - province.origin.r;
  if (dq === 0 && dr === 0) return layout;

  const newCells = province.cells.map((c) => ({ q: c.q + dq, r: c.r + dr }));
  const newKeys = new Set(newCells.map(hexKey));

  for (const p of layout.provinces.values()) {
    if (p.moduleId === moduleId) continue;
    for (const c of p.cells) {
      if (newKeys.has(hexKey(c))) return null; // 会压到别的省份
    }
  }

  const provinces = new Map(layout.provinces);
  provinces.set(moduleId, { ...province, origin: newOrigin, cells: newCells, center: newOrigin });

  // 先清旧键再写新键：同一省份平移后新旧格子可能重叠（如 (1,0) 平移半径 1 的省份）
  const cellToFile = new Map(layout.cellToFile);
  const fileToCell = new Map(layout.fileToCell);
  const oldKeys = new Set(province.cells.map(hexKey));
  const myFiles: Array<[string, Axial]> = [];
  for (const [file, cell] of layout.fileToCell) {
    if (oldKeys.has(hexKey(cell))) myFiles.push([file, cell]);
  }
  for (const key of oldKeys) cellToFile.delete(key);
  for (const [file, cell] of myFiles) {
    const moved = { q: cell.q + dq, r: cell.r + dr };
    fileToCell.set(file, moved);
    cellToFile.set(hexKey(moved), file);
  }

  return { provinces, cellToFile, fileToCell, fileCount: layout.fileCount, bounds: boundsOf(provinces) };
}

/** 轴坐标 → 世界像素（pointy-top） */
export function hexToWorld(h: Axial, size = HEX_SIZE): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

export function hexCorners(h: Axial, size = HEX_SIZE): Array<{ x: number; y: number }> {
  const { x, y } = hexToWorld(h, size);
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({ x: x + size * Math.cos(angle), y: y + size * Math.sin(angle) });
  }
  return corners;
}

/** 世界像素 → 轴坐标（就近四舍五入） */
export function worldToHex(wx: number, wy: number, size = HEX_SIZE): Axial {
  const qF = ((Math.sqrt(3) / 3) * wx - wy / 3) / size;
  const rF = ((2 / 3) * wy) / size;
  // 立方坐标取整
  const x = qF;
  const z = rF;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}
