# 通过 VPN 和个人 SSH 身份接手

本项目支持 Codex → `ssh -T` → 服务器上的 stdio MCP。先验证普通 SSH 登录，之后再配置 MCP。

## 1. 网络连通

若接手者已有 VPN，沿用现有 VPN 即可。管理员需确认其路由、访问规则和目标服务器防火墙允许到达目标主机的 SSH 端口。VPN 显示“已连接”并不保证拥有目标内网网段的访问权。

Windows PowerShell 检查，替换示例主机名：

```powershell
Test-NetConnection games-host.example.org -Port 22
```

`TcpTestSucceeded: True` 表示 TCP 端口可达，尚未证明 SSH 身份有效。其他系统可用 `ssh -o ConnectTimeout=10 用户名@目标主机` 检查连接。超时先检查路由与防火墙，`Permission denied (publickey)` 则检查账号、公钥和 Agent。

没有既有 VPN 时，可由管理员建立到目标主机的 VPN 通道，例如普通 SSH 经 Tailscale 网络连接。需要保留原内网地址时，可采用子网路由并单独授予目标主机、端口访问权。这里不自动安装 VPN 或改变网络配置。参考：[SSH over Tailscale](https://tailscale.com/docs/reference/ssh-over-tailscale)、[子网路由](https://tailscale.com/docs/features/subnet-routers)。

## 2. 接手者准备自己的身份

可使用已受控的个人 SSH 密钥或在自己电脑上新建专用密钥。以下命令需在 `~/.ssh` 已存在且目标文件不存在时运行；遇到覆盖提示应取消并换文件名：

```sh
ssh-keygen -t ed25519 -f ~/.ssh/board_games_operator -C board-games-operator
```

私钥留在自己电脑或密码管理器内，使用口令和 SSH Agent。只把生成的 `board_games_operator.pub` 公钥交给服务器管理员，不发送私钥。

如果使用 Bitwarden SSH Agent，使用接手者自己保管的密钥并解锁 Agent；配置中的 `IdentityFile` 可指向对应公钥来选择 Agent 内的身份。仅复制别人的 `.pub` 文件不能登录。参考：[Bitwarden SSH Agent](https://bitwarden.com/help/ssh-agent/)。

## 3. 管理员登记授权

管理员为接手者建立或指定独立账号，将其公钥追加到该账号配置的 `AuthorizedKeysFile`（常见为 `~/.ssh/authorized_keys`），保留已有授权。通常 `.ssh` 使用 700、`authorized_keys` 使用 600，且属于该账号；实际位置及额外限制以服务器 sshd 配置为准。参考：[OpenSSH authorized_keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)。

按工作分配目录和命令权限：

- 盘点人员：读取内容并调用只读 MCP。
- 内容编辑人员：通过受控入口操作指定游戏数据，写入身份应与播放器的数据权限兼容。
- 部署人员：按授权更新代码、安装依赖、重启指定服务。

能够登录不等于能读取应用的私有数据。避免通过开放整个数据目录或授予任意 `sudo node` 来绕过权限；能以服务账号执行任意 Node 代码就相当于拥有该账号的全部能力。需要委托 MCP 时，由管理员维护启动脚本、代码及准确的提权规则。

## 4. 核对指纹并测试登录

将 [SSH 模板](ssh-config.example)对应条目合并到自己的 `~/.ssh/config`，替换主机、账号和密钥路径，不覆盖其他主机配置。管理员通过已有可信渠道提供主机指纹。

首次手动连接：

```sh
ssh -o StrictHostKeyChecking=ask board-games-prod
```

只有指纹一致才接受。登录后退出，再验证 Codex 使用的非交互方式：

```sh
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes board-games-prod 'id; command -v node'
```

必须在运行 Codex 的同一电脑和环境中测试。若密钥带口令，先装入 SSH Agent；Agent 根据自身设置可能要求确认。不要让自动化依赖在 MCP 协议输入中输入密码。

## 5. 接入远程 MCP

管理员将仓库部署到固定目录、执行 `npm ci`，并创建 [只读启动入口](board-games-mcp-readonly.sh.example)。脚本模板默认采用“登录账号能直接读取数据”的模式；若需要切换服务身份，应由管理员单独配置受限入口。

然后将 [Codex 模板](codex-remote-readonly.toml.example)合并到客户端配置，重新打开会话，发现 8 个工具，再调用 `list_games`、`get_game` 与 `export_links`。此时工具应读取服务器的内容。

启动 MCP 的 shell、登录脚本和包装脚本不得往 stdout 打印提示；日志应写 stderr。不要分配伪终端。若 SSH 能登录但 MCP 启动失败，检查固定代码路径、Node、依赖、文件权限和 stdout 日志。
