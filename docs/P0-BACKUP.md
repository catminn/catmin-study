# P0：离线存档审计操作

这是只读备份流程，**没有从实际线上账号读取或备份数据**。运行前需用户从已有网站或 Artifact 导出完整的旧版 JSON 状态，确保取得数据的方式符合网站原有权限。不包含 Google token、API key 或未公开故事内容的公开分享。

在支持 Node.js 的本地环境：
```bash
node --test test/study-core.test.mjs test/audit-legacy-save.test.mjs
node scripts/audit-legacy-save.mjs exported-state.json backup-state-2026-10-28.json
```

- 输入文件只读取，不覆盖；输出备份使用独占文件创建，已存在时失败；输出权限限制为当前用户访问（操作系统支持时）。
- 备份保留原始 JSON 全部字段及账本，无 `trimState` 历史裁剪。审计只报告积分、账本数量、错题数量及旧重置标记风险，不更改任何存档。
- 脚本校验写出的备份和输入快照的 JSON 内容相同；这**不是**线上恢复验收。真实恢复测试需要隔离测试数据库及人工授权。
- 旧 UI 的 `S`、各学科 `chat-*`、`chat-zero` 与 `lib-*` 可能分开存储；只导出 `S` 不代表完成**全量存档**备份。未来实现应对全部文档集建立一致性快照。
- 生产数据库、用户浏览器和 Claude Artifact 的存档路径尚未执行数据读取或真实备份。不要因为本脚本通过就开始迁移生产。
- 绝不可把真实存档、课程文件或隐藏剧情提交到公开 GitHub 仓库。
