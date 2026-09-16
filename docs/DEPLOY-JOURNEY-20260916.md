# 代表事项与办理体验改进版｜上线记录

2026-09-16，用户授权发布当前最新代码并推送仓库分支。正式域名已切换至新版本，云端状态 READY，线上检查通过。

## 版本与入口

- [正式演示](https://longsheng-office-0910.vercel.app/office#home)
- [仓库分支](https://github.com/Ksaveworld/longsheng-office/tree/codex/demo-journey-acceptance-20260916)：`codex/demo-journey-acceptance-20260916`。
- 应用源码：`bcb55fc90075568bbf9b58666c81c0f96f668da5`。上线后的提交仅更新本说明、README、验收状态、证据和清单，应用代码与该提交一致。
- Vercel 项目：`kwillsaveworld/longsheng-office-0910`。
- 部署：`dpl_Cnsjtpa9QkL8wETbhY567tpYo4xr`。
- [固定部署地址](https://longsheng-office-0910-pu21owakm-kwillsaveworld.vercel.app/office#home)。

沿用现有 Production 模型配置和私有 Blob 保存方式，没有修改凭据，没有重置访客空间。先构建并验证固定部署地址，完成全链回归后再 promote 至正式入口。main 未合并。

## 线上实际验证

固定部署地址执行原代表事项浏览器检查的 7 个阶段，仅适配地址、证据目录、网络代理及等待时长：

1. 四种业务类型各一例；供应延期仅 SUP-001／M-01，分类统计与卡片一致。
2. M-02 至 M-06、SUP-010 搜索为零；旧链接提供代表事项入口，隐藏会话接口拒绝。
3. 导入配套合成 CSV，真实模型查询“有到料风险且至少晚 2 天”，命中 ORD-001-01 一条，原始来源可打开；A／B、两张订单和会议资料保留。
4. 选择 B，准备申请、取消、重新准备、提交；发起人看到“你当前无需操作”，当前仍采用 A。
5. 显式切换质量岗位，接收、开始、提交核验；核验通过后仍采用 A。
6. 负责人批准后切换 B，另行发送任务；采购与销售分别接收并提交回执，负责人复核关闭；刷新后关闭状态保留。
7. 已办结计数更新为 1，代表事项仍共 4；其余三个案例数据不变；新访客保持初始状态；1440／1024／390 像素宽度检查通过。

正式域名另完成 6 项检查：与固定部署地址使用相同前端入口资源；上线前独立测试访客的 M-01 申请状态逐字段保留、可见目录从 10 条变为 4 条；免登录打开且首页／详情／助手／业务依据状态一致；刷新后进度保留；390 像素交接页无横向溢出；新访客隔离；公开重置返回 403、退役事项返回 410。其中多项相关断言合为一个检查项，详细分组见 JSON。

两次线上浏览器检查均无脚本错误。实际查看了正式入口的提交成功截图。上线前 145 项业务测试及本地浏览器验收结果沿用，因为应用源码未继续修改；本轮另有云端 TypeScript／Vite 构建成功及部署 READY 证据。

## 证据

- [上线前独立测试访客状态摘要](evidence/journey-online-20260916/before.json)
- [固定部署全链验证](evidence/journey-online-20260916/candidate/verification.json)
- [正式域名与旧访客状态验证](evidence/journey-online-20260916/canonical.json)
- [正式首页](evidence/journey-online-20260916/canonical-home.png)
- [正式提交成功与岗位交接](evidence/journey-online-20260916/canonical-handoff.png)
- [正式手机宽度交接页](evidence/journey-online-20260916/canonical-mobile.png)
- [线上完整办结](evidence/journey-online-20260916/candidate/07-closed.png)

证据来自本次独立合成测试会话，不含访客 Cookie、模型密钥或真实客户数据。连接测试最初因 API 请求未使用本机代理而超时；显式使用现有代理后通过，未修改应用代码解决该网络问题。线上测试没有执行内部故障注入。

本次证明了发布版本与工程行为；仍未开展真实业务人员无讲解上手测试。演示岗位不代表生产身份权限，部门回执和办公关闭不代表真实到货或交付。
