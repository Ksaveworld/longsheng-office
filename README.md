# 龙盛办公协同 POC

当前分支为 2026-09-16 代表事项与办理体验改进版，已发布到正式演示入口，并完成线上回归。

仓库中的旧 `docs` 与 `deploy` 材料保留历史用途；当前运行方式与能力边界以本 README 为准。

- 分支：`codex/demo-journey-acceptance-20260916`。
- 先看[按岗位操作指南](docs/DEMO-USER-GUIDE.md)，工程与浏览器结果见[本轮验收记录](docs/DEMO-JOURNEY-ACCEPTANCE-20260916.md)。
- 业务主线：收到 M-01 供应延期通知 → 查询订单影响 → 选择备选方案 → 提交核验并交给质量岗位 → 负责人批准 → 采购和销售回执 → 复核关闭。
- 首页每种业务类型保留一个代表事项：供应延期、质量异常、设备检修、客户订单变更，共四条。
- 正式演示入口：https://longsheng-office-0910.vercel.app/office#home 。当前部署 `dpl_Cnsjtpa9QkL8wETbhY567tpYo4xr`，应用源码提交 `bcb55fc`；[上线记录与线上证据](docs/DEPLOY-JOURNEY-20260916.md)。后续提交只补充说明、截图及文件清单，应用代码保持一致。
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

`test:office` 包含 145 项办公业务检查和本地模拟模型协议测试，不需要真实模型密钥。本轮另执行了两组浏览器脚本，共 14 个检查阶段；其中完整 M-01 链路包含真实模型查询。执行条件和证据见[本轮验收记录](docs/DEMO-JOURNEY-ACCEPTANCE-20260916.md)。`docs/SYNC-20260916.md` 保留此前源码同步记录。

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

本分支基于此前上线源码，加入代表事项目录、统一办理中心、各入口状态摘要和异常反馈。测试的外部样例文件仍放在 `tests/fixtures`，启动器统一 Node 运行时并使用项目内临时 npm 缓存。

没有包含真实密钥、本地环境配置、数据库、个人会话、内部会议材料、node_modules 或构建产物。`docs/evidence` 中本轮新增截图及记录均来自独立合成测试会话。`SOURCE-MANIFEST.json` 给出本分支 Git 文件内容的校验值，不代表线上部署结果。

## 许可证与标识

界面基于 satnaing/shadcn-admin，保留原 MIT LICENSE 及署名。依赖项各自许可证继续适用。爱化身名称与 Logo 用于演示标识；源码交付不授予商标权利。
