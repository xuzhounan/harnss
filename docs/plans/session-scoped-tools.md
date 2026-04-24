# Plan: Session-scoped Tools Panel

Status: DRAFT — awaiting review
Branch: `feat/session-scoped-tools`
Author: xuzhounan (with Claude + Codex)
Created: 2026-04-24

## 问题陈述

右侧工具栏（Terminal / Browser / Source Control / activeTools / 布局比例）当前绑在
 Space 或 Project 层级，切 session 时内容不跟着换。用户期望：**切 session = 换工
作台**（对齐 Claude Desktop 的心智）。

## 目标

1. 右侧工具栏**全部**状态绑定到当前 Session
2. Session delete / archive 时，其所有工具资源（pty 进程、webview tab、布局、激
   活工具集）一同回收
3. Session 切走（非删除）时，pty 和 webview 实例保留在后台，回到 session 时瞬时
   恢复
4. 现有用户数据无痛迁移

## 非目标

- 不砍 Space 概念（仅作视觉分组，不再影响工具栏作用域）
- 不做 Browser 的 per-session cookie 隔离（共享 partition）
- 不恢复 app 重启前的 pty 进程（pty 是 ephemeral，重启后显示为空 tab，点击后按
  上次 cwd 重新 spawn）

## 关键设计决策

### D1. pty 生命周期

| 事件 | 行为 |
|---|---|
| session 切走 | pty **保留**（npm run dev 之类的不中断） |
| session 切回 | 秒开（xterm 连接已有 pty） |
| session delete / archive | **kill pty**（连带 shell 和所有子进程） |
| app 退出 | 所有 pty 随主进程一并结束 |
| app 重启 | tab metadata 恢复（标题、cwd），显示为"空 tab"，点击后 auto-respawn |

**进程数软上限**：超过 30 个活跃 pty 时，UI 右下角提示"大量 terminal 占用系统
资源"，不强制回收。

### D2. Browser 生命周期

- 同 pty：切走保留、删除回收、重启丢失
- 所有 session 共享默认 `<webview>` partition（登录态互通）
- 未来可加"私密 session"选项独立 partition，**本次不做**

### D3. 存储模型

**新 key 结构**：
```
harnss-session-${sessionId}-active-tools    (Set<ToolId>)
harnss-session-${sessionId}-tool-order      (ToolId[])
harnss-session-${sessionId}-suppressed      (Set<ToolId>)
harnss-session-${sessionId}-bottom-tools    (Set<ToolId>)
harnss-session-${sessionId}-layout          (布局比例 JSON)
harnss-session-terminals                    (单 key，存所有 session 的 tab metadata Map)
harnss-session-browsers                     (同上)
```

**删除 session 时清理**：hook 到 `sessions:delete` IPC，删除前调用
`cleanupSessionResources(sessionId)`：
1. kill 所有该 session 的 pty 进程
2. destroy 所有该 session 的 webview
3. 批量 `localStorage.removeItem(key)` 清理 UI 状态 key

### D4. 数据迁移

**策略：读时回退（lazy fallback），写时只写新 key**

```ts
function readSessionActiveTools(sessionId, projectId) {
  const sessionKey = `harnss-session-${sessionId}-active-tools`;
  if (localStorage.getItem(sessionKey) !== null) {
    return JSON.parse(localStorage.getItem(sessionKey));
  }
  // Fallback to legacy project-level
  const legacyKey = `harnss-${projectId}-active-tools`;
  return JSON.parse(localStorage.getItem(legacyKey) ?? "[]");
}
```

好处：
- 老用户第一次打开 session，工具栏状态继承原有 project 级配置
- 任何改动写入新 key，不污染老数据
- 1 个月后可加一次性迁移脚本清理残留老 key（本次不做）

### D5. Terminal pty 归属

主进程 `Map<sessionId, Map<terminalId, PtyProcess>>` 替换现有的 `Map<spaceId,
...>`。IPC 协议：

- `terminal:create({ sessionId, cwd, cols, rows })` — 旧参数 `spaceId` 弃用
- `terminal:destroySession(sessionId)` — 新增，在 session 删除钩子里调用
- `terminal:list({ sessionId })` — 支持按 session 过滤

### D6. Draft session 处理

Session 在 "draft" 阶段（用户点 "+" 但还没发消息）尚无正式 ID。工具栏状态先绑
在临时 draftId（已存在）。materialize 成真 session 时：
1. 生成新 sessionId
2. remap：把 `harnss-session-${draftId}-*` 的 storage key 和
   `sessionTerminals`/`sessionBrowsers` Map 里的 entries 改名成新 sessionId
3. 原 draftId 的资源引用被释放

### D7. Space/Project 的新角色

- Space：仅作视觉分组、主题色、底部 bar 图标。不再影响任何工具状态
- Project：作为 session 的归属容器，提供默认 cwd；侧边栏树形结构不变
- Source Control 面板：默认按当前 session 的 project 过滤（只显示该 project 的
  git 仓库），可一键切 "聚合所有 project" 视图

## 实施阶段

### Phase 1：基础设施 + activeTools/布局 session 化
- 新增 `useSessionScopedSettings(sessionId)` hook（或 Zustand session slice）
- 迁移 `activeTools` / `toolOrder` / `suppressedPanels` / `bottomTools` / 布局比
  例到 session 维度
- Terminal / Browser 暂时继续用 spaceId（不动）
- 实现 D4 的 lazy fallback 逻辑
- 加 session delete 钩子：清理 UI 状态 key
- 验收：切 session 时激活工具集、布局会换；激活状态随 session 持久化；删除
  session 时清理对应 localStorage key

预估：1 天

### Phase 2：Terminal session 化
- 主进程 IPC：把 `terminal:*` 的 spaceId 参数改成 sessionId
- `useSpaceTerminals` 重构为 `useSessionTerminals`
- 实现 "切走保留、删除回收" 的 pty 生命周期
- 实现 D5 的主进程 Map 结构
- 实现 D6 的 draft-to-session 资源迁移
- app 退出时广播 "kill all ptys"
- 验收：切 session Terminal tabs 完全隔离；`npm run dev` 切走回来还在跑；删除
  session 后 pty 进程消失

预估：1.5 天

### Phase 3：Browser session 化
- `BrowserPanel` 的 tabs 按 sessionId 分桶
- webview 实例懒启动（切回才 mount）；session 存在期间不 destroy
- session delete 时 destroy 所有关联 webview
- 验收：切 session Browser tabs 隔离；切回时页面状态保留；删除 session 后
  webview 不泄露

预估：1 天

### Phase 4：UI 语义告知 + 清理
- Source Control 面板加"仅当前 project / 所有 project"切换
- 工具面板头部加副标题 "Session: {session title}"，强调作用域
- 清理旧 space 级 key 的读取逻辑（迁移逻辑仍保留一个版本周期）
- 更新 `CLAUDE.md` 的 "Tools Panel System" 章节描述
- 验收：用户打开任意面板都能清楚知道作用域；CLAUDE.md 和实现一致

预估：0.5 天

**总预估：4 天**

## 风险

| 风险 | 缓解 |
|---|---|
| pty 进程数无上限增长 | 软阈值提示（30 个），未来按需加 LRU |
| webview 累积造成内存泄漏 | session delete 必须 destroy；加监控埋点 |
| Draft session materialize 时 storage key remap 失败 | 加回退：如果 remap 失败，保留老 key 读取不丢数据 |
| localStorage 5MB 配额（N 个 session × 多个 key） | 单 session 的 UI 状态 key 总计 < 2KB，1000 个 session 才 2MB，安全 |
| Phase 2 改动 IPC 协议打破任何外部调用 | Harnss 是桌面客户端，无外部 IPC 消费者，唯一消费方是 renderer |

## 回滚策略

每个 Phase 对应 1 个 commit（必要时多个），tag 为 `phase-1-done` /
`phase-2-done` 等。任何 phase 出问题都可 `git reset --hard` 回到上一 tag。

数据层：localStorage 新增 key 不覆盖老 key，任何 phase 回滚后老数据仍可用。

## 验收总清单

- [ ] 切 session 后右侧**所有**面板状态（activeTools、tab 列表、布局、
      terminal 内容、browser 页面）独立且正确
- [ ] session A 里跑 `npm run dev`，切去 session B 再回来，server 仍在运行
- [ ] 删除 session 后，对应 pty 进程消失（`ps aux | grep zsh`），对应
      localStorage key 清理
- [ ] 首次打开老用户的 project 下的 session，工具栏继承原 project 级设置
- [ ] app 重启后所有 pty 显示为"空 tab"，点击后按原 cwd 重新 spawn
- [ ] Source Control 面板默认只显示当前 project，可切聚合
- [ ] CLAUDE.md 中 "Tools Panel System" 章节描述与实现一致

## 待用户确认的决策点

- [ ] D1 pty 生命周期：切走保留 / 切走 kill？（我默认：切走保留）
- [ ] D2 Browser 共享 partition？（我默认：共享）
- [ ] D3 localStorage 新 key 命名 OK？
- [ ] D7 Space 保留作分组 OK？
- [ ] 4 天工作量可以接受？
