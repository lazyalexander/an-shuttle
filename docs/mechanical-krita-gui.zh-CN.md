# 机械成片参考帧的 GUI 回存

[English](mechanical-krita-gui.md) · 简体中文

蒸汽机和四缸成片的首帧通过既有 CAD spool ORA 打包器形成 film-reference 图层，再由现有 `openInKrita` Shuttle 交给 Krita 5.3.4。验收在真实 GUI 中新增绘画图层、绘制笔迹、保存原生 KRA，关闭后通过同一桥接重开。

两份文档均保留两个可编辑绘画图层，尺寸为 1920 × 1080。回存后的合成图相对原参考帧分别有 389 和 8,251 个像素变化，证明 GUI 编辑实际持久化。[验收摘要](acceptance/mechanical-krita-gui.json)记录结果。此处验证首帧参考与绘画图层的回存，Blender 场景和 CAD 零件分层分别验收。

复跑时先构建 Shuttle，调用 `packages/krita/dist/document.js` 的 `openInKrita` 打开选定 ORA。在图层菜单新增绘画图层，画出笔迹，再选择另存为。保存过滤器须明确选择 Krita 文档格式，仅改扩展名可能仍被补上 `.ora`。关闭并重开 KRA，检查图层和笔迹。

原始 KRA 略超既有 8 MiB 产物上限，因此对 ZIP 容器做无损重压缩。逐条比较条目内容和顺序均一致，mimetype 条目保持不压缩，压缩后的两份 KRA 均已通过 GUI 重开。原始文件保存在本地，宿主限额保持原值。

随后通过既有宿主工作区验证任务，绑定原始成片 revision、提取基准帧、检查 KRA 格式、尺寸、两个绘画图层和像素变化，并正式接收固定 KRA 与报告 revision。GUI 应用由用户持有，宿主验证返回文件并负责接收后的产物保管。

合并顺序为 an-agent #216 → Loom #113 → an-spool #6 → 本 PR。复用已有应用桥接，未增加 GUI 驱动。原始 UI 状态、授权文件和工作记录保留在本地。
