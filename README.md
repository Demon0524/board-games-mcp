# board-games-mcp

使用官方 Model Context Protocol TypeScript SDK v2 的 **stdio MCP 服务**，管理桌游文字线索：多个游戏 → 多个故事（汤题）→ 每个故事的多条独立线索。

每条线索有稳定的 NFC 入口；玩家页面只展示该故事的共同汤面、当前线索、场景名称和可选音频。保存草稿不会更改已发布页面。只有显式发布指定的最新草稿才会上线。

仓库包含完整播放器、存储层、MCP 服务、合成示例、真实协议客户端和测试。示例内容均为虚构，不包含真实游戏资料、运行数据、媒体、凭据或 NFC 映射。代码未授予开源许可证（`UNLICENSED`）；公开可见不代表已授予再分发许可。依赖各自遵循其许可证。

## 快速运行

**交给其他用户使用：**先阅读[下载、运行与 Codex 接手指南](docs/handoff/README.md)。其中包含可直接复制给 Codex 的任务说明、VPN/SSH 登录步骤和远程只读配置模板；实际服务器资料由管理员单独提供。

需要 Node.js 22 或更新版本。Windows PowerShell、Linux 均可运行：

```sh
git clone https://github.com/Demon0524/board-games-mcp.git
cd board-games-mcp
npm ci
npm test
npm run demo
```

`npm run demo` 使用真实 SDK 客户端启动 stdio 子进程，完成发现工具、校验、保存草稿、显式发布和 NFC 导出。它始终使用新建的系统临时目录，覆盖继承的生产路径和只读配置，不触碰现有内容。最后输出临时目录路径，供检查；不自动删除演示结果。

独立启动 MCP：

```sh
node src/server.mjs
```

启动后等待 stdin 的 MCP 请求，没有网页界面；stdout 专用于协议。日志只写 stderr。正常由 Codex 等客户端启动和管理进程，不需要另外常驻一个 MCP 实例。

播放器另开一个终端：

```sh
npm run player
```

默认监听 `http://127.0.0.1:3000`。MCP 和播放器的 `BOARD_GAMES_ROOT` 必须指向同一个绝对目录。默认是仓库中的 `runtime/`；如需展示 demo 结果，应使用 demo 输出的临时目录。播放器没有内容管理 HTTP 接口；MCP 不监听 HTTP 端口。

自动生成包含当前机器绝对路径的 Codex 本地配置：

```sh
npm run config:codex --silent
```

默认只读；执行 `node scripts/codex-config.mjs --root "数据目录" --writable` 可生成本地编辑配置。命令只输出 TOML，不会改写现有配置。具体步骤见[接手指南](docs/handoff/README.md)。

## 工具

| 工具 | 用途 | 是否改变公开内容 |
| --- | --- | --- |
| `list_games` | 列出已发布游戏、草稿和版本标记 | 否 |
| `get_game` | 读取 `published` 或 `draft`，查看版本和素材 ID | 否 |
| `validate_import` | 校验增量补丁及合并结果，不写文件 | 否 |
| `save_draft` | 保存独立草稿，校验当前草稿版本 | 否 |
| `preview_clue` | 返回指定最新草稿中单条线索的 HTML | 否 |
| `import_asset` | 从受控目录登记音频，返回素材 ID | 否 |
| `publish_draft` | 显式发布最新草稿，核对公开版本 | **是** |
| `export_links` | 导出已发布内容的直达 URL 和 NFC URL | 否 |

所有工具输入均采用严格 schema，未知字段被拒绝；例如 `published: true` 不能混入导入补丁绕过发布流程。业务错误返回 `isError: true` 和 JSON 错误码；schema 错误由 SDK 返回。客户端应先检查错误，再读取 `structuredContent` 或文本 JSON。

### 内容字段

`save_draft` 和 `validate_import` 接受同样的 `patch`：

| 层级 | 字段 | 说明 |
| --- | --- | --- |
| 游戏 | `key` | 必填，稳定标识；小写字母、数字、单连字符，最长 80 字符 |
| 游戏 | `type` | 可省略；提供时只能为 `puzzle_clue` |
| 游戏 | `title` | 新游戏必填 |
| 游戏 | `displayName`, `tagline` | 可选显示名称、副标题；省略时从标题和主题生成 |
| 游戏 | `theme`, `description`, `listed` | 主题、简介、是否展示在首页；新游戏默认不列出 |
| 游戏 | `puzzles[]` | 按 `key` 增量合并故事 |
| 故事 | `key`, `title`, `surface` | 稳定标识、故事标题、共同汤面；新故事三者必填 |
| 故事 | `hostNotes` | 可选主持人私有备注；不会进入玩家 HTML/API |
| 故事 | `clues[]` | 按 `key` 增量合并线索 |
| 线索 | `key`, `text` | 稳定标识、当前线索文字；新线索必填 |
| 线索 | `scene` | 可选场景名称，可用空字符串清除 |
| 线索 | `audioAssetId` | 当前游戏内已有音频 ID；`null` 清除音频 |
| 三层均可 | `enabled` | 下次发布后是否对玩家开放；新增默认 `true`，已存在时省略则保留 |

标题等短文本最多 300 字符，汤面、线索、主持人备注各最多 50,000 字符，场景最多 500 字符。每个游戏最多 200 个故事，每个故事最多 200 条线索。不得把完整答案或其他线索放进 `surface` / `text`；这些字段就是玩家会看到的内容。

两个完整示例各含两个故事、每个故事两条线索：

- [`examples/observatory.json`](examples/observatory.json)：雪夜观测站。
- [`examples/harbor.json`](examples/harbor.json)：机械港湾。

两例刻意使用部分相同故事/线索 key，展示不同游戏之间的隔离。重复 key 在同一个数组中会报错，不会出现后写覆盖前写的歧义。

### 草稿 → 预览 → 发布

1. `get_game({"gameKey":"observatory","view":"draft"})` 读取已有草稿；新游戏先通过 `list_games` 确认不存在。
2. `validate_import({"patch": <示例 JSON>})`。校验是只读操作，并不锁定未来状态，保存时会重新校验。
3. `save_draft({"patch": <示例 JSON>, "expectedDraftVersion": null})`。只有首次草稿用 `null`，后续必须传上次读取到的 `latestDraftVersion`。
4. 使用返回的 `draftVersion` 调用：

```json
{
  "gameKey": "observatory",
  "draftVersion": "<save_draft 返回的 UUID>",
  "puzzleKey": "missing-star",
  "clueKey": "first"
}
```

以上是 `preview_clue` 的参数。返回的 `html` 可保存为本地 HTML 查看，仅包含当前线索与共同汤面。草稿音频不开放公共 URL，返回 `audioAssetId` 供管理端核对。

5. 确认要上线的具体内容后，调用 `publish_draft`：

```json
{
  "gameKey": "observatory",
  "draftVersion": "<同一最新草稿 UUID>",
  "expectedPublishedVersion": null
}
```

首次发布使用 `null`；更新时使用 `get_game` 的 `publishedVersion`，且必须与草稿创建时的公开版本一致。版本是字符串，不要自行计算或改写。发布后可调用 `export_links({"gameKey":"observatory"})`。

6. 玩家直达链接形如 `/g/observatory/p/missing-star/clues/first`，NFC 链接为 `/n/<随机固定码>`。NFC 应写入后者。只有发布之后才能导出可用入口。

### 增量更新、撤下与并发

更新一条并新增一条的补丁如下；其他故事及线索会原样保留：

```json
{
  "key": "observatory",
  "puzzles": [{
    "key": "missing-star",
    "clues": [
      { "key": "first", "text": "更新后的第一条线索。" },
      { "key": "third", "scene": "露台", "text": "新增的第三条线索。" }
    ]
  }]
}
```

数组省略、空数组、遗漏已有 key **都不代表删除**。本服务不提供物理删除和 key 重命名；传入新 key 代表新增，旧 key 仍然保留。需要撤下时，对对应游戏、故事或线索显式设置 `enabled: false`，保存后再发布。其原 NFC 暂时返回 404，重新设为 `true` 并发布后同一个 NFC 恢复。UUID 和 NFC 码不会复用给其他内容。

`save_draft` 使用预期草稿版本防止覆盖另一位编辑者；`publish_draft` 只接受最新草稿，并核对草稿基于的公开版本与当前公开版本。重复发布同一版本是幂等的。过期发布不会回退已发布内容。

若其他程序改变了已发布游戏，旧草稿发布会报 `CONFLICT`，即使传了新的公开版本也不会强制覆盖。先读取两边内容并人工合并，然后调用 `save_draft`，额外传入 `fromPublishedVersion: <当前 publishedVersion>`：它会从当前已发布内容开始合并本次补丁，生成新草稿。旧草稿未包含在本次补丁中的修改不会带入；旧草稿文件仍保留。此操作同样校验 `expectedDraftVersion`，不会立即上线。

`get_game` 默认不返回主持人备注；只有管理客户端显式指定 `includeHostNotes: true` 才返回。管理员拥有整个游戏的管理权限；这不是玩家接口。公开页面没有其他线索的列表，但已发布的直达链接仍可由持有者访问，NFC 链接本身不是身份认证。

## 音频素材

1. 先保存游戏草稿。
2. 设置 `BOARD_GAMES_IMPORT_ROOT`，将音频放入该目录。
3. 调用 `import_asset({"gameKey":"observatory","relativePath":"audio/clue.wav"})`。
4. 将返回的 `assetId` 写入相应线索的 `audioAssetId`，保存并显式发布。

支持 `.mp3`、`.m4a`、`.ogg`、`.wav`、`.flac`、`.aac`，单文件非空且不超过 64 MiB。扩展名是格式白名单，不执行转码或完整音频解码验证。可直接引用 `get_game` 列出的当前游戏素材 ID。缺失文件、未知 ID、跨游戏引用会拒绝；同游戏相同内容及扩展名导入会复用 ID。

路径必须相对于导入根目录，拒绝绝对路径、`..` 和解析到根目录外的符号链接。导入目录应由管理者控制，不要允许不可信进程同时替换其中的文件。素材复制为独立文件，导入源之后可移动。导入本身不会使音频公开，只有引用它的线索实际发布后才可访问；所有公开引用撤下后素材 URL 返回 404。

**通过 SSH 运行 MCP 时，文件路径属于远程服务器。** 本机 `C:/audio/...` 不会自动出现在服务器上；先用自己的 SFTP/SCP 工作流把音频传入服务器的导入目录，再传相对路径。上传行为与 MCP 的发布行为独立。

## 环境配置

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `BOARD_GAMES_ROOT` | 仓库 `runtime/`；运行数据根目录，建议显式绝对路径 |
| `BOARD_GAMES_PUBLIC_ORIGIN` | `http://127.0.0.1:3000`；导出的公开 URL 起点，只允许 http(s) 的 origin |
| `BOARD_GAMES_IMPORT_ROOT` | 未配置时禁止导入音频 |
| `BOARD_GAMES_READ_ONLY` | MCP 设置为 `1` 时禁止保存、发布、导入；连接与读取不写存储 |
| `HOST`, `PORT` | 仅播放器使用；默认 `127.0.0.1`、`3000` |

`BOARD_GAMES_PUBLIC_ORIGIN` 必须与玩家实际访问的域名一致；不包含子路径、账号密码、查询参数。管理进程通过本地进程权限或 SSH 认证授权，不提供匿名远程管理 HTTP 服务。向公网提供播放器时，可让已有反向代理转发到其本地端口。

### Codex 本地 stdio

在 `~/.codex/config.toml` 加入或更新对应服务项，替换示例绝对路径。Windows 路径可使用正斜杠：

```toml
[mcp_servers.board_games]
command = "node"
args = ["C:/projects/board-games-mcp/src/server.mjs"]
startup_timeout_sec = 20

[mcp_servers.board_games.env]
BOARD_GAMES_ROOT = "C:/game-data"
BOARD_GAMES_IMPORT_ROOT = "C:/game-imports"
BOARD_GAMES_PUBLIC_ORIGIN = "https://games.example.org"
```

也可使用 `codex mcp add`。配置键和 CLI 方式依据 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。本项目不会自动修改你的客户端配置。

### SSH stdio

在服务器安装本仓库并执行 `npm ci`；选择有权访问数据根目录的运行账号。通过 SSH 的标准输入输出承载 MCP，不要分配终端：

```toml
[mcp_servers.board_games_remote]
command = "ssh"
args = ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "games-host", "/usr/local/bin/board-games-mcp"]
startup_timeout_sec = 30
```

`games-host` 是你在 `~/.ssh/config` 中配置的主机别名。使用现有 SSH Agent（例如密码管理器的 SSH Agent）或已有密钥配置；不要将私钥或密码写进仓库。首次使用前通过正常 SSH 流程核对主机指纹并验证登录。

远程启动脚本 `/usr/local/bin/board-games-mcp` 示例：

```sh
#!/bin/sh
export BOARD_GAMES_ROOT=/srv/game-data
export BOARD_GAMES_IMPORT_ROOT=/srv/game-imports
export BOARD_GAMES_PUBLIC_ORIGIN=https://games.example.org
exec /usr/bin/node /opt/board-games-mcp/src/server.mjs
```

给脚本执行权限，确保启动脚本和 shell 初始化文件不向 stdout 打印欢迎消息。若只需盘点，在脚本中设置 `BOARD_GAMES_READ_ONLY=1`。Windows 上 SSH Agent 是否可用取决于运行 Codex 的进程环境；先在相同环境用 `ssh -T games-host` 验证。

## 存储与兼容性

```text
<BOARD_GAMES_ROOT>/
  state/catalog.json              # 稳定 ID、NFC、当前公开快照指针、草稿版本索引
  data/drafts/<gameKey>/<uuid>.json # 私有不可变草稿
  data/games/<gameId>/revisions/   # 私有内容快照；播放器按当前版本读取
  data/host-only/                 # 主持人备注
  storage/assets/<gameId>/        # 私有音频；受已发布引用控制
  media/                         # 可选的旧版章节媒体
```

同一数据根目录上的写入用排他锁串行化，校验后以临时文件及原子重命名切换 `catalog.json`。正常失败会清理本次生成的草稿、素材或新快照，保留现有章节、映射及已发布版本。进程被强制终止或断电时可能留下未引用文件或锁，不会自动清理；备份整个根目录，勿只备份 registry。当前面向单机本地文件系统，不保证网络文件系统的锁与重命名语义。

兼容已有 `version: 1` catalog 中的 `audio_chapter` 与 `puzzle_clue`。旧音频章节支持盘点、读取、NFC 导出和原播放器路由（包括 `/1.1`）；**本版 MCP 编辑接口只处理 `puzzle_clue`**。现有媒体、章节 ID 和 NFC 不需要重建。接入旧数据前先用副本验证，再做只读盘点；新仓库不含任何现有部署的数据。

## 测试和故障处理

`npm test` 由官方客户端通过真实 stdio 连接服务进程，再对真实 Express 页面发 HTTP 请求，覆盖：

- 工具发现、两故事四线索、草稿 404、显式发布、预览隔离。
- 更新一条 / 新增一条不删除同级内容，UUID/NFC 在重启后保持稳定。
- 重复 key、缺失必填内容、未知或跨游戏素材、缺失文件、非法字段被拒绝且无部分写入。
- 不同游戏使用相同 key 的隔离，撤下/恢复入口，旧音频章节兼容。
- 两个 MCP 客户端竞争写入、旧草稿拒绝发布、外部变更冲突及显式重新合并。
- 音频目录穿越/符号链接拒绝，未发布素材不可访问，已发布音频字节一致。
- 公开 HTML/API 不含兄弟线索/主持人备注，HTML 转义，只读模式不写数据。

CI 在 Ubuntu、Windows 的 Node.js 22/24 上执行同一测试，依赖由 lockfile 固定。`npm audit` 可查看依赖报告。

| 现象 / 错误 | 处理 |
| --- | --- |
| MCP 连接后没有网页 | stdio 服务正常等待客户端；网页由 `npm run player` 提供 |
| 连接失败或 JSON 解析错误 | 检查 Node 路径、`npm ci`、SSH 登录和 stdout 是否混入日志 |
| `CONFLICT` | 重新读取草稿/公开版本；需要时按上文明确合并，勿盲目重复发布 |
| `BUSY` | 等待另一写入完成；若进程已崩溃，确认所有写进程停止并备份后，才人工处理 `catalog.json.lock` |
| `READ_ONLY` | 当前实例用于盘点；在预期的编辑实例操作 |
| `NOT_FOUND` / `STORAGE` | 检查 MCP 所在机器的路径和运行账号权限，查看 stderr |
| 素材不可用 | 先登记同游戏素材 ID，确认文件存在，再发布引用它的线索 |
| 玩家页面仍为旧内容 | 草稿保存不会上线；核对发布结果、共享数据根目录和反向代理缓存 |

SDK 参考：[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。项目使用 `@modelcontextprotocol/server` 的 `serveStdio` 与 `@modelcontextprotocol/client`，没有自制 JSON-RPC 协议替代品。
