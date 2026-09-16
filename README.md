# 龙盛办公协同 POC

当前代码对应 2026-09-16 发布的供应延期 POC 补齐版。

仓库中的旧 `docs` 与 `deploy` 材料保留历史用途；当前运行方式与能力边界以本 README 为准。

- 在线演示：https://longsheng-office-0910.vercel.app/office#home
- 对应部署：`dpl_FpQmF7iEjWGWVdVJxzhP2ezjWHwc`。
- 业务主线：导入配套合成 CSV → 业务对象与关联 → 程序筛选和日期计算 → 模型回答与来源追溯 → 人工核验、批准、任务回执和关闭。
- 数据均为合成演示资料，未接入客户生产数据或目标人力小模块。岗位切换是演示身份；办公办结不代表到货或交付。

## 环境与快速启动

需要 **Node.js 24.x** 与 npm。克隆仓库或解压源码包，在有 `package.json` 的目录操作。依赖按锁文件安装，首次安装需要网络；启动器使用同一个 Node 24 进程执行 npm，并使用项目内临时缓存，不依赖原机器的全局缓存目录。

Windows 可以双击 `start-demo.cmd`，它会安装依赖、构建并以规则演示启动，不需要模型密钥。也可在终端运行：

```sh
npm run demo:local
```

看到 `DEMO READY` 后打开 http://127.0.0.1:5194/office#home 。保持终端运行，按 Ctrl+C 停止。若端口占用，在 PowerShell 中先设置 `$env:OFFICE_LOCAL_PORT='5198'` 再启动。

规则演示适合查看界面、确定性计算和办理流程，**不等于真实模型问答**。它使用独立的 `.office-data/local-demo/office.sqlite`；该目录在首次运行时生成，没有包含在源码包内。

## 接入自己的模型

```sh
npm ci --cache .runtime/npm-cache
npm run build
```

将 `.env.example` 复制为 `.env`，填写你获准使用的 OpenAI 兼容服务 `MODEL_BASE_URL`、`MODEL_NAME` 和 `MODEL_API_KEY`。配置保留 `OFFICE_MODEL_MODE=live`，然后启动：

```sh
node --env-file=.env server/office-server.mjs
```

打开 http://127.0.0.1:5194/office#home 。模型连接失败会明确报错，不会悄悄切换为规则答案。此方式默认数据目录为 `.office-data/office.sqlite`；可通过 `OFFICE_DATA_PATH` 指定路径。

## 重现代表性问题

1. 进入“业务依据”，选择 SUP-001，导入 `public/supply-samples/Supplier.csv` 和 `Order.csv`。
2. 点击“校验并预览导入”，核对 A 从 D6 变为 D9，再确认导入。
3. 在真实模型模式的业务助手提问：“筛选当前有到料风险且至少晚 2 天的订单，统计数量并引用导入记录。”
4. 应命中 ORD-001-01，共 1 条；两张订单分别晚 4 天、1 天。结果卡解释另一张订单为何未纳入，来源可点到 CSV 原始行。
5. 改问“至少晚 5 天”，应返回 0 条且不放宽条件。

只支持既有两家供应商、两张订单的配套合成样例格式；事项进入办理流程后不能再覆盖导入。新浏览器访客空间独立，旧状态不会自动清空。

## 验证与目录

```sh
npm run test:office
npm run build
```

`test:office` 包含 144 项办公业务检查和本地模拟模型协议测试，不需要真实模型密钥。本次同步的验证记录见 `docs/SYNC-20260916.md`。

| 目录 | 用途 |
| --- | --- |
| `src` / `public` | 前端、品牌资源和合成 CSV 样例 |
| `server` | 对象、流程、查询计算、来源、模型调用和数据存储 |
| `api/office.mjs` | Vercel 无服务器入口 |
| `tests` | 业务测试、协议模拟及完整样例文件 |
| `scripts/start-local-demo.mjs` | 本地规则模式启动器 |

## 自行部署到 Vercel

本项目包含后端，不能仅上传 `dist` 作为完整系统。包内保留 `vercel.json` 和服务端入口，但不含原账号的 `.vercel` 关联、访问凭据或在线会话。

在你自己的 Vercel 项目使用 Node 24，创建私有 Blob 存储并配置 `BLOB_READ_WRITE_TOKEN`，再配置三个 `MODEL_*` 服务端环境变量。现有服务端入口使用 Vercel 域名校验；其他域名需要单独适配。公开演示中仅开放受限合成导入，内部重置和故障注入仍被禁止。

## 包内容与原始项目的差异

应用的 `src`、`server`、`api`、`public`、构建配置及锁文件按当前上线版本保留。为了独立交付，测试的外部样例文件已移入 `tests/fixtures`，对应测试只改了引用路径；启动器统一 Node 运行时并使用项目内临时 npm 缓存；README、空环境模板和忽略规则按源码包整理。

没有包含真实密钥、本地环境配置、数据库、个人会话、Git 历史、历史截图、内部会议材料、node_modules 或构建产物。`SOURCE-MANIFEST.json` 给出逐文件校验值及交付调整。

## 许可证与标识

界面基于 satnaing/shadcn-admin，保留原 MIT LICENSE 及署名。依赖项各自许可证继续适用。爱化身名称与 Logo 用于演示标识；源码交付不授予商标权利。
