# an-shuttle

[English](README.md) · 简体中文

an-agent 的应用桥梁：捕获选定的文档版本，协调用户交互，把已验收的产物交回应用。

- **an-agent**：任务权限、调度、外部 harness 监督、生命周期、活动记录和产物保管。
- **an-loom**：spool 开发、校验与打包。
- **an-spool**：成熟领域知识、材质策略与渲染实现。
- **Shuttle**：应用快照、编辑锁、披露与交付。

## 示例：CAD → Krita

保存一个 CAD 版本，得到可在 Krita 分层编辑的透明绘画。CAD 是验证应用桥接的示范案例。

![按零件分层的 CAD 绘画](examples/cad-paint/sample/vise.png)

[配置、验收与限制](docs/cad-paint.zh-CN.md) ·
[分层样品](examples/cad-paint/sample/vise.ora) ·
[领域 spool 目录](https://github.com/lazyalexander/an-spool)

## 开发

使用 Node 22 或更新版本，运行 `npm ci --ignore-scripts`、`npm run build` 和 `npm test`。
渲染测试需要示例文档列出的 Python 依赖。浏览器测试使用 Chrome；Codex 协议测试和真实模型、Krita 验收分别记录。

`packages/view` 管理视图绑定，`packages/cad` 捕获 CAD 状态，`packages/krita` 打开已验收文档。
`examples/plate` 是最小视图示例；`examples/cad-paint` 演示完整应用交互。
领域策略从 an-spool 导入，不在桥接层维护副本。
