[English](./README.en.md) | 简体中文

# GoldMiner On-chain

本地优先的 `Phaser + Rust + Solidity` 链游参考实现。

## TL;DR

- 想最快跑起来：执行 `make dev`，默认本地链是 `31337`，前端通常在 `http://localhost:5173`。
- 想最快读懂：先看 `Casual` 本地玩法，再看 `Adventure / Campaign`，最后看 `Ranked` 的可信验证路径。
- 当前公开仓库版本只保留中英文 README，核心说明以这份文档为准。

## 项目定位与边界

这个仓库把 `Phaser` 游戏前端、`Solidity` 合约、`Rust` 验证 API 和本地读模型
组合成一个可以完整跑起来的教学型项目。它最适合拿来学习、演示和二次开发，
而不是直接当成公网正式排行榜的生产框架。

如果你第一次进入这个仓库，先记住这三点：

- 这是一个“本地优先”的链游参考实现，不是默认面向公网的托管服务。
- 你可以先跑通完整链路，再按 `Casual / Adventure / Ranked` 三种模式理解这个项目。
- 当前公开仓库版本刻意保持精简，项目说明集中保留在中英文 README 中。

当前已知边界也建议提前了解：

- 默认目标环境是 `anvil@31337`。
- `Ranked` 当前是最完整的可信验证路径。
- `Casual` 和 `Campaign` 还没有像 `Ranked` 那样完全 authoritative。
- 自托管本地链路不提供很强的 anti-cheat 信任保证。

## 项目截图

下面这些截图覆盖了当前仓库里最核心的游戏界面。每张图都按业务场景单独展示，
方便你先建立界面与流程的整体印象，再回头读代码或继续扩展文档。

### 首页与入口

**主菜单**

这是项目的首页入口。你可以从这里进入试玩、冒险、排位，也可以看到右上角的钱包状态区。

![项目首页](./docs-assets/main-menu-screen.png)

### 冒险模式

**冒险目标说明页**

进入冒险后，玩家会先看到当前关卡的目标说明页。这里负责把关卡目标、当前进度和继续提示交代清楚。

![冒险目标说明页](./docs-assets/adventure-goal-briefing-screen.png)

**冒险局内界面**

这是冒险模式的核心玩法界面。玩家会在这里完成抓取、达标、使用道具和推进关卡的主要循环。

![冒险局内界面](./docs-assets/adventure-gameplay-screen.png)

**冒险暂停界面**

局内按下暂停后，会进入暂停菜单。这里可以继续本局、重开当前局，或者退出当前冒险流程。

![冒险暂停界面](./docs-assets/adventure-gameplay-pause-screen.png)

**冒险商店界面**

每一关之间会进入商店。玩家可以在这里购买炸药或临时增益，然后带着购买结果进入下一关。

![冒险商店界面](./docs-assets/adventure-shop-screen.png)

**冒险中心**

冒险中心负责承接钱包连接后的多关挑战入口、历史记录摘要和继续开始冒险的主操作。

![冒险中心](./docs-assets/adventure-center-screen.png)

### 排位模式

**排位局内界面**

这是排位挑战的核心 gameplay 界面。它对应单 challenge 的可信验证路径，也是当前 authoritative 体验最完整的一条链路。

![排位局内界面](./docs-assets/ranked-gameplay-screen.png)

**排位中心**

排位中心负责展示挑战入口、排行榜相关信息和排位挑战的状态承接，是进入 ranked 流程的主要入口页。

![排位中心](./docs-assets/ranked-center-screen.png)

## 5 分钟跑通

如果你已经装好了基础工具，最快的启动方式只有一条命令：

```bash
make dev
```

它会按顺序完成：

1. 启动或重启本地 `Anvil`
2. 部署合约并同步运行时配置
3. 启动 `Rust API`
4. 拉起前端开发服务器

### 前置依赖

- Node.js 和 npm
- Rust toolchain 与 Cargo
- Foundry，包括 `forge` 和 `anvil`

### 跑通后你会看到什么

- 前端开发服务器会启动在本地 Vite 地址，通常是 `http://localhost:5173`
- 本地链默认是 `31337`
- Rust API 默认地址是 `http://127.0.0.1:8788/api`

### 最小验证动作

跑通后，建议你按下面顺序做一次最小验证：

1. 打开首页，确认菜单能正常进入试玩模式。
2. 试玩一局，确认本地玩法链路可用。
3. 连接钱包后进入排位或冒险，确认钱包与链路可正常工作。

如果你想跑一轮仓库级检查：

```bash
make test
```

这个命令会覆盖合约、后端、前端以及精选浏览器烟测。

## 三种模式一览

第一次理解这个项目时，不要先陷进实现细节，先把三种模式的边界分清楚。

| 模式 | 主要目标 | 是否上链 | 你应该先关注什么 |
| --- | --- | --- | --- |
| `Casual` | 纯本地玩法体验 | 否 | Phaser 场景流、局内状态、目标页与结算页 |
| `Adventure / Campaign` | 多关推进与本地优先验证流程 | 会同步结果 | 多关 run、商店、session、campaign evidence |
| `Ranked` | 单挑战可信验证与排行榜 | 会同步结果 | replay evidence、Rust verifier、authoritative runtime |

## 业务主流程与学习顺序

如果你想知道“这个项目到底是怎么一步步长出来的”，最容易理解的顺序不是先看合约，
而是先按玩法复杂度往上爬。

1. `Casual`
   - 先理解最纯粹的本地玩法循环：`Goal -> Gameplay -> Shop -> Result`。
   - 这一层最适合用来建立 Phaser 场景流、局内状态和基础 UI 的心智模型。
2. `Adventure / Campaign`
   - 在本地玩法之上，增加多关推进、商店购买继承、钱包连接、session 和 campaign evidence。
   - 这一层最适合理解“为什么不是所有内容都直接上链”，以及本地优先验证流程怎么工作。
3. `Ranked`
   - 最后再进入单挑战可信验证路径，理解 replay evidence、Rust verifier、authoritative runtime 和排行榜同步。
   - 这是当前最完整、最接近可信结算真相源的一条链路。

如果你只是想最快读懂这个仓库，建议把“先跑通 -> 先懂 Casual -> 再看 Adventure -> 最后看 Ranked”当成默认学习顺序。

## 仓库结构

如果你准备继续往下读代码，先从这几个目录建立心智模型。

| 目录 | 作用 |
| --- | --- |
| `frontend/` | Phaser + TypeScript 客户端、钱包 UX、场景与 E2E 测试 |
| `backend/` | Rust 验证核心与 API 服务 |
| `contracts/` | Solidity 合约与 Foundry 部署、测试环境 |
| `scripts/` | Manifest 构建、合约同步和本地工具脚本 |
| `assets/` | 运行时共享游戏资源 |

## 常用命令

日常本地开发最常用的是下面这些命令。

| 命令 | 作用 |
| --- | --- |
| `make dev` | 启动完整本地链路 |
| `make deploy` | 部署合约并同步本地运行时配置 |
| `make api` | 在前台启动 Rust API |
| `make web` | 启动前端开发服务器 |
| `make test` | 运行合约、后端、前端与精选烟测 |
| `cd frontend && npm run test:e2e:smoke` | 运行精选浏览器烟测 |
| `cd frontend && npm run test:stability` | 运行 Playwright 稳定性测试 |

如果你只想分步启动，也可以按这个顺序执行：

```bash
make anvil
make deploy
make api
make web
```

## 关键环境变量

根 README 只保留本地跑通常见的关键变量。完整变量说明请直接查看
`.env.example`、`frontend/.env.example` 和 `frontend/.env.local.example`。

| 变量 | 用途 | 默认值 / 示例 |
| --- | --- | --- |
| `RPC_URL` | 本地区块链 RPC 地址 | `http://127.0.0.1:8545` |
| `CHAIN_ID` | 本地链 ID | `31337` |
| `API_BASE_URL` | 前端请求的 API 地址 | `http://127.0.0.1:8788/api` |
| `PRIVATE_KEY` | 本地 deployer / relayer / verifier 私钥 | Anvil 默认私钥 |
| `VITE_RUNTIME_CONFIG_PATH` | 前端运行时配置路径 | `/contract-config.json` |

## 公开仓库说明

为了让 GitHub 展示层更精简，当前公开仓库版本只保留中英文两份 README 作为文档入口。
如果你准备继续整理成更完整的开源文档站，可以在后续版本里再补回教程、架构说明和
专题文档。

## 作者

这个项目由 `lllu_23` 维护与公开整理。

- 作者：`lllu_23`
- 联系邮箱：`lllu238744@gmail.com`

## 许可证

本仓库基于 [MIT License](LICENSE) 发布。
