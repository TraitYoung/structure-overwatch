/** 确定性的模块配色：同一模块名在地图与面板中颜色一致 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) | 0) >>> 0;
  return h;
}

export interface ProvinceColor {
  hue: number;
  fill: string;
  border: string;
  bright: string;
}

const cache = new Map<string, ProvinceColor>();

export function provinceColor(moduleName: string): ProvinceColor {
  const hit = cache.get(moduleName);
  if (hit) return hit;
  const hue = (djb2(moduleName) * 137.508) % 360;
  const color: ProvinceColor = {
    hue,
    fill: `hsl(${hue.toFixed(0)}, 42%, 40%)`,
    border: `hsl(${hue.toFixed(0)}, 60%, 62%)`,
    bright: `hsl(${hue.toFixed(0)}, 70%, 72%)`,
  };
  cache.set(moduleName, color);
  return color;
}

/** 健康度 → 建筑色相（0=红 60=黄 120=绿） */
export function healthColor(health: number): string {
  const h = Math.max(0, Math.min(100, health));
  return `hsl(${((h / 100) * 120).toFixed(0)}, 62%, 50%)`;
}
