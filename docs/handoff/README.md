# 下载后交给另一位 Codex 用户

这份公开交接包包含代码、虚构示例、配置模板和接手流程。真实服务器地址、账号、数据路径、主机指纹、游戏内容及 NFC 映射由管理员单独提供；下载仓库不会自动获得现有服务器权限。

## 先在本机运行

需要 Node.js 22 或 24、npm；使用 Git 克隆或在 GitHub 选择 Code → Download ZIP 后解压。所有命令在仓库根目录执行。

```sh
git clone https://github.com/Demon0524/board-games-mcp.git
cd board-games-mcp
npm ci
npm test
npm run demo
```

演示会在新建的临时目录中发布虚构游戏，不接入现有网站。记下最后一行 `Temporary demo data:` 后的完整路径。

### 在浏览器查看演示

Windows PowerShell，把下面的目录换成演示刚刚输出的路径：

```powershell
$env:BOARD_GAMES_ROOT = 'C:/替换为演示数据目录'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
npm run player
```

Linux / macOS：

```sh
BOARD_GAMES_ROOT='/替换为演示数据目录' HOST=127.0.0.1 PORT=3000 npm run player
```

打开 <http://127.0.0.1:3000>，也可打开演示输出的线索或 NFC 链接。终端需保持运行，结束时按 Ctrl+C。下次继续查看应保留并使用同一个数据目录；重新运行 demo 会创建另一套独立数据。

### 把本机 MCP 接入 Codex

另开终端，在仓库根目录执行。下面用演示目录接手已有示例，默认只读：

```sh
node scripts/codex-config.mjs --root "替换为演示数据目录"
```

程序输出已经填入本机 Node、代码和数据绝对路径的 TOML。将输出中的服务项合并到自己的 `~/.codex/config.toml`（Windows 通常是 `%USERPROFILE%/.codex/config.toml`）；若设置过 `CODEX_HOME`，以该配置目录为准。保留其他设置，同名服务项只保留一份。重新打开 Codex 会话后，让它发现工具并调用 `list_games`、`get_game`、`export_links`。

要在自己的本地数据中练习新增、保存和发布，重新生成带 `--writable` 的配置：

```sh
node scripts/codex-config.mjs --root "替换为演示数据目录" --writable
```

省略 `--root` 时使用仓库的 `runtime/`，初始没有游戏。`--imports` 指定受控的本机音频目录；`--origin` 指定导出链接的域名。生成器只输出文本，不安装配置、不创建数据、不访问远程服务器。修改域名不会把本机 MCP 变成远程 MCP。

官方配置参考：[Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。完整字段、版本与发布规则见[项目说明](../../README.md)。

## 接手已有服务器

1. 管理员通过私下渠道提供下表中的部署资料。
2. 按[远程登录说明](REMOTE-ACCESS.md)验证 VPN、个人 SSH 身份和主机指纹。
3. 确认远程 MCP 已安装在固定目录，依赖齐全；参考[只读启动脚本](board-games-mcp-readonly.sh.example)。模板文件本身不代表服务器已经安装。
4. 合并 [SSH 配置模板](ssh-config.example)和 [Codex 远程配置模板](codex-remote-readonly.toml.example)，先盘点内容和导出入口。
5. 将[接手提示词](CODEX-TASK.md)交给对方的 Codex。正式编辑时使用管理员另行授权的可写入口，按已确认的发布范围操作。

| 管理员单独提供 | 接手者要核对 |
| --- | --- |
| VPN 连接方式、目标主机、SSH 端口 | VPN 能到达该主机及端口；网页能打开不代表 SSH 可达 |
| 个人登录账号、已登记的公钥指纹 | 对方持有自己的对应私钥或已解锁的 Agent |
| 服务器 SSH 主机指纹 | 首次连接的指纹一致；不可直接忽略变化 |
| MCP 代码目录、Node 路径、启动脚本 | 固定目录确实存在；临时验证目录可能被清理 |
| 网站目录、运行账号、服务名 | 代码、数据与运行服务的关系明确 |
| 数据根目录、公开域名、素材导入目录 | MCP 与播放器读同一份数据；账号具有所需权限 |
| 已发布入口清单、内容待确认事项 | 保留既有 ID 和 NFC；未确认内容不自行发布 |
| 授权范围、备份位置 | 区分只读盘点、内容编辑、代码部署与系统管理 |

通过 SSH 承载的是 stdio MCP，没有公开的 `/mcp` 管理网址。Codex 自动启动 SSH 子进程，无需给 MCP 另外开放 HTTP 端口。远程音频路径属于服务器，先上传到管理员指定目录，再调用 `import_asset`。

`BOARD_GAMES_READ_ONLY=1` 禁止该 MCP 进程写内容，但不限制 SSH 账号本身能执行什么命令。仅允许盘点的账号若要强制只读，需要管理员同时限制系统权限和命令入口。

不要把私下收到的部署说明、实际配置、密钥、媒体、主持人答案或生产数据提交回公开仓库。公开仓库用于分发程序和通用文档；现场交接资料独立保管。
