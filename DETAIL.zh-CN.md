# Planpilot 详细说明

English version: [DETAIL.md](DETAIL.md)

本文档承载主 README 之外的低层细节。
如果你只关心价值、安装和快速上手，请先看 `README.zh-CN.md`。

## 运行模型

- 层级结构：`plan -> step -> goal`。
- 状态传播：
  - 含 goal 的 step 只有在全部 goal 为 `done` 时才是 `done`。
  - plan 只有在全部 step 为 `done` 时才是 `done`。
- 自动续跑：当 OpenCode 空闲，且活动 plan 的下一个待执行 step 为 `executor="ai"` 时触发。

## 工具能力（高层）

命名空间：

- `plan`：生命周期、检索、活动计划控制。
- `step`：顺序管理、执行者分配、等待标记。
- `goal`：step 下的验收检查点。

Agent 常用操作：

- `plan add-tree`, `plan activate`, `plan show-active`, `plan deactivate`
- `step show-next`, `step done`, `step wait`
- `goal done`

## 自动续跑说明

- `session.idle` 始终是触发条件，不能关闭。
- 可选事件触发规则可在配置中启用（`onSessionError`、`onSessionRetry`、权限/提问事件）。
- `step wait <id> --delay <ms>` 会在 step comment 写入等待标记，并在到达时间前延迟分发。
- 当出现 `MessageAbortedError` 时，手动停止保护会抑制排队中的自动发送，直到新用户消息到来。

## 路径解析与环境变量

Planpilot 的本地状态存储在统一数据目录下。

- OpenCode 配置根目录
  - 默认：`~/.config/opencode`
  - 覆盖：`OPENCODE_CONFIG_DIR=/abs/path`
- Planpilot 数据目录
  - 默认：`~/.config/opencode/.planpilot`
  - 覆盖：`OPENCODE_PLANPILOT_DIR=/abs/path`
  - 兼容别名：`OPENCODE_PLANPILOT_HOME=/abs/path`
- Planpilot 配置文件
  - 默认：`<planpilot_dir>/config.json`
  - 覆盖：`OPENCODE_PLANPILOT_CONFIG=/abs/path/to/config.json`

数据布局：

- `planpilot.db`：SQLite 存储。
- `plans/plan_<id>.md`：Markdown 快照。

## 默认配置

所有字段均可选；缺失或非法值会回退到默认值。

```json
{
  "autoContinue": {
    "sendRetry": {
      "enabled": true,
      "maxAttempts": 3,
      "delaysMs": [1500, 5000, 15000]
    },
    "onSessionError": {
      "enabled": false,
      "force": true,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      },
      "errorNames": [],
      "statusCodes": [],
      "retryableOnly": false
    },
    "onSessionRetry": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      },
      "attemptAtLeast": 1
    },
    "onPermissionAsked": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onPermissionRejected": {
      "enabled": false,
      "force": true,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onQuestionAsked": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onQuestionRejected": {
      "enabled": false,
      "force": true,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    }
  },
  "runtime": {
    "paused": false
  }
}
```

校验与归一化行为：

- 未知字段会被忽略。
- 字符串数组会进行 trim 并去重。
- 数字数组仅保留有限整数并去重。
- 必须为正整数的字段在非法时回退默认值。

运行时说明：

- `runtime.paused` 会持久化并通过 Studio 暴露。
- 当前自动续跑核心行为主要由触发规则匹配与活动 step 可执行性决定。

## 事件规则结构

每个可选的 `autoContinue.on*` 规则都支持：

- `enabled`：启用规则。
- `force`：命中规则时绕过默认安全防护。
- `keywords`：文本过滤规则，包含 `any`、`all`、`none`、`matchCase`。

事件专有过滤字段：

- `onSessionError`：`errorNames`、`statusCodes`、`retryableOnly`。
- `onSessionRetry`：`attemptAtLeast`。

## Studio Bridge 协议

构建产物：

- Manifest：`dist/studio.manifest.json`
- Bridge 入口：`dist/studio-bridge.js`
- Web 挂载资源：`dist/studio-web/`

Bridge IO 协议：

- 输入：通过 stdin 传入 JSON。
- 输出：通过 stdout 返回 JSON envelope：`{ ok, data | error }`。

常见 action 分组：

- `config.get`, `config.set`
- `runtime.snapshot`, `runtime.next`, `runtime.pause`, `runtime.resume`
- `plan.*`, `step.*`, `goal.*`（包含 tree 相关 helper）
- `events.poll`

Studio 能力：

- `chat.sidebar`：展示运行态与下一步上下文。
- `settings.panel`：基于插件设置 schema 渲染。

## Settings Schema 映射

- Studio 设置表单由 manifest 中的 `settingsSchema` 生成。
- 字段路径与配置键一一对应（例如 `autoContinue.onSessionError.keywords.any`）。
- `config.set` 会将归一化后的配置写回最终解析出的配置文件路径。
