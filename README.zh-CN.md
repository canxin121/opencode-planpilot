# opencode-planpilot

English version: [README.md](README.md)

Planpilot 为 OpenCode 提供结构化执行循环，让多步骤工作更有条理、更可追踪，也更容易持续推进。

## 为什么选择 Planpilot

- 将复杂任务拆解为清晰的 `plan -> step -> goal` 流程。
- 当下一个待执行步骤归属 `ai` 时自动续跑，保持执行节奏。
- 本地持久化进度（数据库 + Markdown 快照），上下文不丢失。
- 你只需用自然语言下达目标，Planpilot 负责保持执行结构。

## 安装

在 OpenCode 配置文件 `opencode.json` 中添加插件：

- Unix/macOS: `~/.config/opencode/opencode.json`
- Windows: `%USERPROFILE%\\.config\\opencode\\opencode.json` (for example: `C:\\Users\\<your-user>\\.config\\opencode\\opencode.json`)

```jsonc
{
  "plugin": ["opencode-planpilot"]
}
```

OpenCode 会在会话启动时自动安装 npm 插件。

## 自然语言快速开始

示例提示：

```text
使用 planpilot。
```

## OpenCode Studio 集成体验

Planpilot 提供一流的 OpenCode Studio 集成体验：

- 项目地址：[opencode-studio](https://github.com/canxin121/opencode-studio)

- 在 Studio 侧边栏查看运行态上下文（活动计划、下一步、进度状态）。
- 使用 Studio 设置面板调整运行态和自动续跑配置。
- 通过 Studio bridge 读取与写入运行态和配置状态。

如果你已经在 OpenCode 中处理多步骤工作，OpenCode Studio 是最快的统一控制台，可用于监控流程、调优行为并保持团队协同。

## 详细说明

更细的配置结构、bridge action、参数级行为和触发规则，见 `DETAIL.zh-CN.md`。

## 许可证

MIT
