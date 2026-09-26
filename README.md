# Structure Survallian · 架构哨站

> AI coding 时代，程序员是架构师。架构哨站让你像玩 P 社游戏 / 环世界一样，**实时注视**一个代码仓库的架构演变——AI agent 每写一个文件、每引入一条依赖，地图上都会即时浮现。

![tech](https://img.shields.io/badge/TypeScript-fullstack-3178c6) ![runtime](https://img.shields.io/badge/Node-%E2%89%A520-339933)

## 它是什么

指向任意 TypeScript/JavaScript 仓库目录，本工具会：

- **解析**：ts-morph 提取文件、import/export、行数、近似圈复杂度（支持 tsconfig paths 别名、桶文件、monorepo workspace）
- **划分省份**：`src/<dir>`（或 workspace 子包）= 省份，文件 = 建筑
- **实时监控**：chokidar 监听文件增删改，增量重解析，毫秒级推送世界变化
- **游戏化呈现**：
  - **主地图**（P 社风俯视）：六边形省份 + 国境线 + 弯曲商路（粗细=依赖权重，带流动虚线），健康度低的省份泛红，循环依赖省份泛紫
  - **城市视图**（环世界风等距）：双击省份下钻，文件=建筑（占地=行数、高度=复杂度、颜色=健康度），模块内依赖是金色道路
  - **边界面板**：违规列表（循环依赖/分层违规/深导入/上帝模块/孤岛模块），点击在地图上触发红色"边境冲突"脉冲
  - **依赖星图**：模块级力导向图，按边类型（值导入/类型导入/外部包）过滤，点选节点与地图联动
  - **编年史**：RimWorld 风事件日志——新违规、违规解除、健康度变化、文件增删，实时滚动

## 快速开始

```bash
pnpm install
pnpm build        # 构建 shared / core / server / web

# 方式一：监控自带演示仓库（预置循环依赖、分层违规等 7 项违规）
pnpm demo         # 打开 http://127.0.0.1:3210

# 方式二：开发模式（server 热重载 + Vite 前端，默认监控 fixtures/demo-repo）
pnpm dev          # 前端 http://127.0.0.1:5173（代理 API/WS 到 3210）

# 方式三：监控任意仓库
node packages/server/dist/cli.js watch /path/to/your/repo [--port 3210]

# 测试
pnpm test
```

> 要求 Node ≥ 20、pnpm ≥ 9（`corepack enable` 后可用）。

## 演示仓库玩法（fixtures/demo-repo）

打开地图后可以看到预置的"案发现场"：

| 违规 | 位置 | 地图表现 |
| --- | --- | --- |
| 文件级循环依赖 | `services/authService.ts ⇄ services/repo/auditRepo.ts` | services 省份泛紫 |
| 省份级循环依赖 | `domain ⇄ utils` | 两省份同时泛紫 + 高危违规 |
| 分层违规（自定义规则） | `ui/panel.ts → services/repo/**` | 边界面板"分层"高危项 |
| 深导入 | `domain/user.ts → utils/format/money.ts` | 中危项 |
| 上帝模块 | `utils` 被依赖 9 次 | 提示项 |
| 孤岛模块 | `legacy` 零依赖 | 提示项 |

试着编辑 `fixtures/demo-repo` 里任意文件：编年史立即滚动、地图上对应格子白色脉冲；把 `src/services/repo/auditRepo.ts` 里对 `AuthService` 的导入删掉，会看到"违规解除"事件。

## 自定义边界规则

在被监控仓库根目录放 `.survallian.json`：

```json
{
  "rules": [
    { "from": "src/ui/**", "deny": ["src/services/repo/**"] }
  ],
  "godModuleFanIn": 12,
  "maxFiles": 5000
}
```

- `rules[].from` / `deny`：glob（支持 `**`、`*`），命中的跨模块导入报高危分层违规
- `godModuleFanIn`：上帝模块 fan-in 阈值（默认 12）
- `maxFiles`：文件数上限，超过则提示降级（默认 5000）

## 架构

```
packages/
├── shared/   协议类型（GraphNode/GraphEdge/WorldSnapshot/WorldDiff/Violation…前后端共享）
├── core/     无头分析引擎
│   ├── parser/      ts-morph：import 边（internal/external/type-only）、LOC、近似圈复杂度
│   ├── modules/     省份划分：src 顶层目录 / monorepo workspace 子包
│   ├── graph/       增量文件依赖图 + 迭代 Tarjan SCC（循环检测）
│   ├── metrics/     fan-in/out、不稳定性、健康度
│   ├── boundaries/  规则引擎 + 极简 glob
│   ├── store/       版本化世界状态、diff 生成、违规对比事件、环形事件日志
│   └── watcher/     chokidar 防抖合批
├── server/   Fastify：GET /api/snapshot、WS /ws、静态托管 web；CLI `survallian watch <repo>`
└── web/      React + zustand + 原生 Canvas 2D
    ├── map/         六边形省份地图（稳定增量布局：文件格子不因新增而跳动）
    ├── iso/         等距城市下钻视图
    ├── panels/      边界面板 / 依赖星图（d3-force）/ 编年史事件条
    └── net/         REST 快照 + WS 增量同步（版本不连续自动回退拉全量）
```

**增量协议**：世界状态带单调递增 version；WS 只推 `WorldDiff`（nodes/edges 增删 + 违规全量 + 新事件）；客户端检测到版本断裂即重新拉快照。

## 已知边界

- 悬停/脉冲等动画依赖浏览器 rAF；后台标签页会暂停，切回即恢复
- 解析精度依赖目标仓库 tsconfig；无 tsconfig 的纯 JS 项目按 `allowJs` 兜底
- v2 候选：git churn 热力、外部 npm 依赖"海外贸易港"、符号级依赖、多语言（tree-sitter）、音效
