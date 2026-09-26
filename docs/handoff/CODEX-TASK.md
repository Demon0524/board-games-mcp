# 复制给接手 Codex 的提示词

以下文本可连同管理员私下提供的部署资料一起交给 Codex。资料中的路径与账号以目标环境为准。

---

请接手 https://github.com/Demon0524/board-games-mcp ，阅读 README.md 和 docs/handoff/README.md。使用我提供的本机或服务器资料，保留已有配置和生产内容。

先完成环境核对：

1. 本机使用时执行 npm ci、npm test、npm run demo；demo 只使用隔离临时数据。需要 Codex 配置时，用 npm run config:codex --silent 生成本机配置片段，结合我指定的数据目录合并到现有配置。
2. 远程使用时先核对 VPN 到目标 SSH 端口的连通性、管理员已授权的个人身份及主机指纹。不要索取或输出私钥。
3. 核实服务器的实际 MCP 代码路径、Node、运行身份、数据目录及公开域名。模板路径不代表部署已完成；临时验证目录不作为长期入口。
4. 先连接只读 MCP（BOARD_GAMES_READ_ONLY=1）。列出工具，调用 list_games、get_game、export_links；对照管理员提供的基线，汇报实际发现的游戏和入口数量。
5. 如果缺少固定部署或系统权限，具体说明所缺条件，并准备可审阅的部署方案。不要把本文当作修改服务器授权、重启服务或发布游戏的指令。

业务规则：

- 一个游戏包含多个故事，每个故事包含多条独立线索。玩家页同时显示共同汤面与当前线索，音频可选。
- 用户完整线索尚未确认时保留当前已发布内容，记录待确认事项，不自行拆分或发布候选文本。
- 主持人答案放在 hostNotes，不能混入 surface 或 clue.text。
- 保留游戏、故事、线索 key、UUID 和 NFC 映射。新增内容会生成新入口；修改文字保留既有入口。
- 用户授权编辑后，先读取版本，再 validate_import → save_draft → preview_clue。依据当前用户已明确授权的发布范围，对具体最新草稿调用 publish_draft，然后 export_links。
- MCP 的增量补丁保留省略项；撤下内容须显式 enabled:false 并发布。不要混用其他旧版导入脚本。
- 此版编辑功能只针对 puzzle_clue；audio_chapter 支持读取、导出与播放器兼容。
- 程序与 state/data/storage/media 分开，测试和 demo 不使用生产目录。
- MCP 与播放器需要读同一数据根目录；远程素材必须先上传到指定的服务器导入目录。
- BOARD_GAMES_PUBLIC_ORIGIN 仅控制 URL 生成，不是远程连接凭据。服务使用 stdio，不提供 HTTP MCP 地址。

完成接手后给出：已核实环境、MCP 实际连接结果、现有游戏与入口数量、待确认内容及缺失的访问条件。后续编辑和部署按我的明确请求继续。
