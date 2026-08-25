<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <strong>dsh-memory</strong> · DeepSeek Harness 长期记忆插件
</p>

<p align="center">
  把会话历史自动提炼为长期记忆：两阶段管道（逐会话提取 → 全局整合），摘要常驻注入新会话，四个工具按需检索。
</p>

## 为什么需要长期记忆

每次新会话都从零开始，用户要反复重申偏好与约定，助手要重新踩一遍已经踩过的坑。
`dsh-memory` 在会话结束后自动把值得沉淀的内容提取出来，定期整合成一份高密度导航摘要
（常驻注入每次会话）和一份可 grep 的检索手册，让未来的会话：
**少听重复的偏好说明、少走弯路、复用被验证过的工作流、避开已知的坑**。

设计参考了 Codex 记忆系统（两阶段提取/整合、三级制品结构、任务租约、冷却、脱敏），
并针对 DSH 重新组合：不需要 SQLite、不需要 git 基线、不需要常驻整合子代理。

## 功能特性

- 🧠 **Phase 1 逐会话提取**：会话结束后（防抖，默认 3 分钟）读取会话日志，过滤渲染 →
  脱敏 → 交给模型提取结构化记忆（`raw_memory` + `rollout_summary` + `slug`）；
  无价值的会话输出空结果自动跳过（no-op 门槛）。
- 🧩 **Phase 2 全局整合**：按冷却周期（默认 6 小时）把新记忆合并进 `MEMORY.md`
  （检索手册）与 `memory_summary.md`（首行 `v1` 协议的高密度导航摘要）；
  原始记忆归档轮转，永不重复整合。
- 🛠️ **技能固化**：重复出现的可验证流程由整合器固化为 `skills/<name>/SKILL.md`
  （含 YAML frontmatter 与触发条件），可附带 scripts/ templates/ examples/ 附属文件；
  过时技能可显式删除。
- 🕰️ **遗忘机制**：`memory_read` / `memory_search` 的查阅行为会记录使用次数与时间；
  超过遗忘阈值（默认 30 天）未被查阅的回顾在整合时被标注为「候选遗忘」，
  由整合器决定是否退役到 `rollout_summaries/.retired/`（可恢复，不直接删除）。
- 📥 **摘要常驻注入**：`memory_summary.md` 内容（有硬上限保护）随 system prompt 注入
  每次会话，模型无需任何操作就能看到导航索引。
- 🔍 **四个记忆工具**：`memory_list` / `memory_read` / `memory_search` /
  `memory_add`（仅在用户明确要求时写入），模型按需检索细节。
- 🔒 **安全纪律**：会话内容一律按数据分析（prompt 注入免疫）；密钥/令牌/私钥在
  输入与输出两侧脱敏；记忆路径越界一律拒绝。
- 🔁 **可靠调度**：每个会话一个租约（KV 持久化），重启不重复处理、不重复整合；
  失败带退避重试；孤儿租约自动回收。
- 📊 **运行记录**：每次提取/整合运行（含模型完整产出）持久化到 `logs/`，设置页可
  展开查看"AI 到底干了啥"，并可打开记忆库管理弹窗浏览任一文件原文。
- 🗂️ **记忆库管理**：设置页「打开记忆库」按钮唤出独立弹窗，以 VS Code 风格层级树
  列出全部文件（文件夹可折叠），支持在线编辑与删除（删除需二次确认），弹窗顶部
  常驻提醒：记忆文件一般无需人工更改，除非你知道自己在做什么。
- ⚙️ **设置页**：设置 → 长期记忆 中查看统计、手动触发提取/整合、查看运行记录、
  记忆库管理（浏览/编辑/删除）、调整冷却/遗忘阈值/模型路由；管道运行中按钮保持
  禁用（关闭页面再打开也不会误以为已解锁）。

## 工作原理

```
会话结束 ──► Phase 1（逐会话）──► rollout_summaries/<slug>.md  +  raw_memories.md
                                          │
                              （冷却到期 / 有新记忆）
                                          ▼
                                   Phase 2（全局）
                                          │
              ┌───────────────────────────┴───────────────────────────┐
              ▼                                                       ▼
   memory_summary.md（常驻注入每次会话）            MEMORY.md（memory_search / memory_read 检索）
```

## 安装

> [!NOTE]
> 使用前请确保已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
>
> 包名说明：`@nanmicoder/dsh-memory` 是包标识（`@nanmicoder` 是 npm 作用域形式，
> `dsh-memory` 是包名）。本插件**通过 GitHub 分发**（不发布 npm），安装方式如下：

```sh
dsh plugin --profile web add 'git+https://github.com/yan5236/dsh-memory.git#main'
```

检查组合配置并启动：

```sh
dsh --profile web --dump-config
dsh web
```

打开 **设置 → 长期记忆** 查看状态；记忆文件默认写入 `$DSH_HOME/memories/`。

> [!TIP]
> 若 `dump-config` 的组合树里没有 `- id: dsh-memory` 这一行，说明 profile 的
> `dsh.profile.bundles` 数组里没有注册这个包（bundle 补丁层未应用），手动把
> `"@nanmicoder/dsh-memory"` 加进该数组即可。

## 📋 一键提示词：让 DSH 自己装

不想手动敲命令？把下面这段整段复制，直接粘贴给 DSH，让它完成安装、注册与验证：

````text
请帮我把 DSH 长期记忆插件 dsh-memory 安装到 web profile，GitHub 仓库：
https://github.com/yan5236/dsh-memory

要求：
1. 运行 dsh plugin --profile web add 'git+https://github.com/yan5236/dsh-memory.git#main'
2. 检查 $DSH_HOME/profiles/web/package.json：dependencies 里应含
   "@nanmicoder/dsh-memory"，且 dsh.profile.bundles 数组应包含
   "@nanmicoder/dsh-memory"（缺少就补上；bundles 缺失会导致插件补丁层不生效）。
3. 运行 dsh --profile web --dump-config，确认输出中出现 "- id: dsh-memory"
   且没有报错。
4. 重启 DSH：先停掉当前 dsh web 进程，再重新运行 dsh web。
5. 验证：设置页出现「长期记忆」；会话工具列表包含 memory_list / memory_read /
   memory_search / memory_add。
6. 若任一步骤写入 DSH 配置目录（$DSH_HOME/profiles）时被权限策略拦截，
   提示用户切换到 Full access 或批准对应操作，不要绕过或静默失败。
````

## 配置

组合 `config` 提供基础层（`cordis.patch.yml` 中的 `config: {}` 使用全部默认值），
设置页可覆写常用项并持久化到 DSH 存储：

```yaml
- id: dsh-memory
  config:
    memoryRoot: C:/path/to/memories   # 默认 $DSH_HOME/memories
    provider: deepseek-official       # 可选：为记忆管道固定模型路由
    model: deepseek-v4-flash          # 与 provider 成对配置
    consolidationCooldownMs: 21600000 # 整合冷却（默认 6 小时）
    idleDebounceMs: 180000            # 轮末防抖（默认 3 分钟）
    maxRolloutsPerRun: 3              # 每轮提取的会话数
    maxSummaryChars: 8000             # 注入摘要的字符上限
```

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `memoryRoot` | `$DSH_HOME/memories` | 记忆根目录 |
| `provider` / `model` | 空 | 空则使用部署默认模型 |
| `idleDebounceMs` | `180000` | 会话轮末后的静默窗口 |
| `maxRolloutsPerRun` | `3` | 每次运行提取的会话数 |
| `extractionConcurrency` | `1` | 提取并发（默认串行，对模型提供方更温和） |
| `minSessionEvents` | `4` | 事件过少的会话直接跳过 |
| `maxRolloutAgeDays` | `30` | 超龄会话标记跳过 |
| `maxTranscriptChars` | `60000` | 送入提取模型的会话文本上限 |
| `phase1MaxTokens` | `4096` | 单次提取输出上限 |
| `consolidationCooldownMs` | `21600000` | 整合冷却（失败后约 15 分钟自动重试，不受冷却限制） |
| `maxRawChars` | `120000` | 单次整合的原始记忆输入上限 |
| `phase2MaxTokens` | `32768` | 单次整合输出上限（全量重写 MEMORY.md 时容易截断，可调至 65536+；上限 131072） |
| `maxSummaryChars` | `8000` | 注入摘要的字符上限 |
| `retryLimit` | `3` | 提取失败重试次数 |
| `maxUnusedDays` | `30` | 遗忘阈值：超过该天数未被查阅的回顾成为候选遗忘（0 = 关闭） |

## 记忆目录结构

```text
<memoryRoot>/
├── memory_summary.md          # 常驻注入的导航摘要（首行 v1）
├── MEMORY.md                  # 检索手册：偏好/流程/失败护盾
├── raw_memories.md            # Phase 1 产出，等待整合
├── raw_memories.archive.md    # 已整合原始记忆的历史归档
├── rollout_summaries/         # 每次会话的回顾（证据层）
│   └── .retired/              # 被遗忘机制退役的回顾（可恢复）
├── skills/                    # 整合沉淀出的可复用流程（SKILL.md + 附属文件）
├── logs/                      # 运行记录（每次提取/整合的完整产出，最多保留 50 份）
└── extensions/ad_hoc/notes/   # memory_add 写入的用户要求笔记
```

## 开发

```sh
pnpm install
pnpm verify
git diff --check
```

设计文档与威胁模型见 [DESIGN.md](./DESIGN.md)。

## 许可证

[MIT](./LICENSE)
