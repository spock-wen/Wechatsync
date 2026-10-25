# Wechatsync 工程指引

## 适用范围

本文件适用于整个仓库；子目录如有更具体的 `AGENTS.md`，在其范围内优先遵循。

- 默认使用简体中文沟通，代码标识符、API 名称和命令沿用工程原文。
- 修改前阅读相关源码和配置，以实际入口、类型及 `package.json` 为准。
- 保持改动聚焦，保留用户已有修改；不要顺带迁移工具链、统一版本或重排无关代码。
- 完成时说明修改内容、验证结果及未验证部分；只报告有证据支持的结果。

## 工程结构与边界

这是使用 pnpm workspace 的 TypeScript monorepo，工作区为 `packages/*`。

| 路径 | 职责与主要入口 |
| --- | --- |
| `packages/core` | 共享类型、`RuntimeInterface`、`CodeAdapter`、适配器注册表及内容转换；入口 `src/index.ts` |
| `packages/extension` | Chrome MV3 扩展、浏览器登录态、平台请求与 UI；后台入口 `src/background/index.ts` |
| `packages/mcp-server` | MCP 工具和扩展桥接；运行入口 `src/index.ts`，桥接导出入口 `src/exports.ts` |
| `packages/cli` | 命令行工具；入口 `src/index.ts`，通过 MCP 包的 bridge 调用扩展 |

- 扩展 UI 使用 React、Tailwind CSS 和 Zustand，入口页面由 `packages/extension/vite.config.ts` 配置。
- 网页提取位于扩展的 `src/content/`，DOM 预处理在内容脚本或 `src/preprocessor/` 页面完成。
- 跨入口同步复用扩展的 `src/background/sync-service.ts` 中的 `performSync`，保持预处理、状态、历史与 CMS 分流一致。
- 保留文章的 `source`、`rawHtml`、`platformContents` 等字段；微信快路径和各平台内容转换依赖这些信息。
- WordPress、MetaWeblog 等 CMS 逻辑位于扩展的 `src/adapters/cms/`。
- 腾讯云、阿里云、华为云通过 `PageAdapter` 将内容交给投稿页；DOM 操作仅在 `page-editor.ts` 的注入函数内执行。

CLI/MCP 的实际调用链是：CLI 或 MCP → `ExtensionBridge` → WebSocket → 扩展 `src/mcp/client.ts` → 同步服务。
CLI 不直接执行平台适配器，仓库也没有可供 CLI 使用的 `NodeRuntime` 实现。
修改 MCP 工具时查看实际入口 `src/index.ts`；仅修改 `src/server.ts` 不会改变当前入口行为。

## 开发与构建

使用 Node.js 20 或更高版本，在仓库根目录执行命令。仓库未指定固定 pnpm 版本。

```bash
pnpm install
pnpm --filter @wechatsync/extension dev
pnpm -r run build
```

根目录的 `dev`、`build`、`test`、`typecheck` 等脚本仍转调 Yarn。
优先使用下列直接调用 workspace 的命令，避免将 `pnpm build` 误认为纯 pnpm 构建流程。
保留现有锁文件；依赖变更按所在 workspace 操作，不顺带重建或删除另一套锁文件。

| 操作 | 命令 |
| --- | --- |
| 构建 core | `pnpm --filter @wechatsync/core build` |
| 构建扩展 | `pnpm --filter @wechatsync/extension build` |
| 构建 MCP | `pnpm --filter @wechatsync/mcp-server build` |
| 构建 CLI | `pnpm --filter @wechatsync/cli build` |
| 启动已构建的 MCP | `pnpm --filter @wechatsync/mcp-server start` |
| core 类型检查 | `pnpm --filter @wechatsync/core typecheck` |
| 扩展类型检查 | `pnpm --filter @wechatsync/extension typecheck` |
| MCP 类型检查 | `pnpm --filter @wechatsync/mcp-server exec tsc --noEmit` |
| CLI 类型检查 | `pnpm --filter @wechatsync/cli exec tsc --noEmit` |
| core 单次测试 | `pnpm --filter @wechatsync/core test --run` |
| 扩展测试 | `pnpm --filter @wechatsync/extension test` |

- 单独构建 CLI 前先构建 MCP：CLI 引用的 `@wechatsync/mcp-server/bridge` 指向 MCP 的 `dist/exports.js`，并被打包进 CLI。
- 扩展通过 Vite alias 直接引用 core 源码，无需预构建 core；扩展 `build` 会先执行 TypeScript 检查。
- 各包模块格式已有差异：core 输出 CJS/ESM，MCP 输出 ESM，CLI 输出 CJS。修改时保留相应格式和可执行入口。
- 本地扩展构建完成后，在 Chrome 扩展管理页加载 `packages/extension/dist`。

## 适配器开发

新增公开平台适配器时：

1. 在 `packages/core/src/adapters/platforms/{id}.ts` 创建继承 `CodeAdapter` 的类。
2. 按现有类型实现 `meta`、`checkAuth()`、`publish()`，按需提供图片上传和 `preprocessConfig`。
3. 在同目录 `index.ts` 导出适配器。
4. 在 `packages/extension/src/adapters/index.ts` 导入，并加入 `ADAPTER_CLASSES`。
5. 检查类型、构建扩展，并验证该平台的登录态、正文、图片和实际保存结果。

修复既有适配器时，先核对对应实现、平台响应、认证信息提取和 Header 规则，优先参考相近平台的现有实现。

- 适配器通过注入的 `RuntimeInterface` 访问请求、Cookie、存储和 Header 规则，保持 core 与浏览器 API 的边界。
- 平台适配器运行于 Service Worker；不要在该执行路径新增对 `DOMParser`、`document`、`window` 或 `localStorage` 的依赖。
- DOM 处理放在现有内容脚本或预处理页面；不要将旧注释中的 Offscreen Document 描述当作已实现能力。
- 临时 Header 规则优先使用 `CodeAdapter.withHeaderRules`；手动管理时检查可选能力并在 `finally` 中清理。
- 沿用统一 logger 和结构化认证、同步结果，正确返回失败原因。
- 保持草稿优先的默认行为；`draftOnly` 的实际效果需按平台实现核实，不能仅凭字段存在断言支持草稿或公开发布。
- 页面适配器只确认填充时返回 `success: false`、`outcome: 'editor_filled'`；展示为待保存，不能归为发布成功或失败重试。新消费者复用结果分类工具。

## 桥接与消息协议

- MCP 桥接在 `packages/mcp-server/src/ws-bridge.ts`，协议类型在该包的 `src/types.ts`。
- 修改请求、响应或同步字段时，同时核对扩展 `packages/extension/src/mcp/client.ts`、MCP 工具入口及 CLI 调用方。
- 桥接优先读取 `WECHATSYNC_TOKEN`，兼容 `MCP_TOKEN`；其值需与扩展中的设置一致。
- 保留扩展端 Token 校验和已有连接、重连、请求关联及超时处理。
- MCP stdio 模式的 stdout 用于协议消息，诊断日志写入 stderr。

## 代码约定

- 沿用相邻文件的 TypeScript、React 和导入风格，通常为 2 空格、单引号、无分号。
- 优先复用已有类型和公共工具；修改共享类型时检查全部使用方。
- 根 TypeScript 配置启用严格检查，扩展有局部覆盖；不要通过全局放宽配置掩盖局部问题。
- 仓库有 ESLint、Prettier 依赖及根 `lint` 脚本，但未提供已提交的统一配置；执行前核实，不将格式化视为已经建立的检查门禁。
- 不为局部修改执行全仓格式化，不无理由改变包的导出方式。

## 验证与完成标准

按改动范围选择验证，明确区分类型检查、构建、自动化测试和浏览器实测。

| 改动 | 验证重点 |
| --- | --- |
| core 转换或图片处理 | core 类型检查、相关单次测试；影响扩展时构建扩展 |
| 适配器、扩展后台或 UI | 扩展类型检查/构建，并在 Chrome 中验证受影响流程 |
| MCP/CLI 或桥接协议 | 相应包类型检查，按 MCP → CLI 顺序构建，验证扩展连通和受影响请求 |
| 文档 | 核对路径、命令与源码，检查 diff；无需为纯文档改动安装依赖或全量构建 |

- core 已有自动化测试在 `packages/core/src/lib/__tests__/`，覆盖 Markdown 图片与 HTML 转 Markdown；默认 `test` 为 watch 模式，单次执行加 `--run`。
- 扩展 Vitest 匹配包内 `__tests__/**/*.test.ts`，已有结果分类、结果展示、编辑器链接与运行时回归用例；新增测试放在配置能发现的位置。
- CLI/MCP 当前没有 `test` 脚本；根测试命令不代表四包均有自动化覆盖。
- 不用 `--passWithNoTests`、跳过测试或占位实现掩盖缺失验证。SDK 手工测试页也不等于自动化测试。
- 浏览器实测检查 Service Worker 错误、账号识别、正文排版、图片转存及目标平台保存结果。
- 登录成功不能证明同步成功，构建成功也不能证明真实平台可用；报告中分别说明已验证和未验证内容。

## 私有内容与生成文件

- `packages/core/src/adapters/platforms/private` 是私有 Git 子模块，由扩展通过 `import.meta.glob` 加载。
- 公开 checkout 可能没有私有适配器；不要补 stub、强制加入被忽略的私有源码，或据 README 平台列表声称所有平台均可用。
- 不提交 `node_modules`、`dist`、覆盖率、日志、压缩包或本地环境文件；配置示例使用 `.env.example`。
- 不在代码、日志、测试夹具或交付说明中保留真实 Cookie、Token、CMS 密码和敏感文章内容。
- 修改扩展源 `manifest.json` 与 Vite 配置，构建过程会处理输出 manifest 和 reader 脚本；不要手改 `dist`。
- `src/lib/reader/` 和 `public/lib/` 中的 JavaScript 是现有源码/静态资源，不能将所有 `.js` 一律视为编译产物删除。
- 各包版本独立维护；涉及扩展发版时核对扩展 `package.json` 和源 `manifest.json` 的版本。

## 参考资料

- `README.md`：产品、安装和集成概览。
- `docs/adapter-spec.md`：适配器设计与开发示例，类型和环境版本以当前源码为准。
- `packages/cli/README.md`、`packages/mcp-server/README.md`：各自使用与集成说明。
- `.claude/commands/`：现有操作提示，执行命令前与当前脚本核对。
- `CONTRIBUTING.md` 仍包含旧包名和旧工作流；不要据此恢复已不存在的目录或照搬历史命令。
