# Handoff: BestBlogs.dev Integration

面向 bestblogs-monorepo 新会话的交接文档。当前 MultiPost fork 已完成扩展侧基础改造，BestBlogs 侧需要补齐网页 SDK、收录 API、发布任务队列。

## 当前扩展侧已经提供

扩展仓库：`/Users/gino/Documents/Github/MultiPost-Extension`

已完成：

- 自动信任 `bestblogs.dev`、`www.bestblogs.dev`、`*.bestblogs.dev`、`localhost`、`127.0.0.1`
- popup 增加“打开发布台”和“收录当前页”
- 新增 action：`MULTIPOST_EXTENSION_BESTBLOGS_SUBMIT_CURRENT_PAGE`
- 当前页收录默认提交到：
  - dev: `http://localhost:3000/api/extension/submit`
  - prod: `https://www.bestblogs.dev/api/extension/submit`

## BestBlogs 侧目标

### A. 网页调用扩展进行多平台发布

在 BestBlogs 前端新增一个轻量 SDK，例如：

```ts
interface ExtensionRequest<T> {
  type: "request";
  traceId: string;
  action: string;
  data: T;
}

interface ExtensionResponse<T> {
  type: "response";
  traceId: string;
  action: string;
  code: number;
  message: string;
  data: T;
}

function requestExtension<TResponse, TData = unknown>(action: string, data: TData): Promise<TResponse> {
  const traceId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("MultiPost extension timeout"));
    }, 5000);

    function handleMessage(event: MessageEvent<ExtensionResponse<TResponse>>) {
      const response = event.data;
      if (response?.type !== "response" || response.traceId !== traceId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

      if (response.code === 0) {
        resolve(response.data);
      } else {
        reject(new Error(response.message));
      }
    }

    window.addEventListener("message", handleMessage);
    window.postMessage({ type: "request", traceId, action, data } satisfies ExtensionRequest<TData>, "*");
  });
}
```

建议封装：

```ts
export const multipostExtension = {
  checkInstalled: () =>
    requestExtension<{ extensionId: string }>("MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS", {}),
  getPlatforms: () =>
    requestExtension<{ platforms: unknown[] }>("MULTIPOST_EXTENSION_PLATFORMS", {}),
  publish: (syncData: unknown) =>
    requestExtension("MULTIPOST_EXTENSION_PUBLISH", syncData),
};
```

BestBlogs 文章页/内容管理页可加“分发”按钮：

1. 调 `getPlatforms()` 获取平台列表。
2. 让用户选择平台。
3. 把 BestBlogs 内容转成 MultiPost `SyncData`。
4. 调 `publish(syncData)` 打开扩展发布确认窗口。

`ArticleData` 结构：

```ts
interface ArticleData {
  title: string;
  digest: string;
  cover: {
    name: string;
    url: string;
    type?: string;
    size?: number;
  };
  htmlContent: string;
  markdownContent: string;
  images?: Array<{ name: string; url: string; type?: string; size?: number }>;
  tags?: string[];
  category?: string | number;
  original?: boolean;
  allowComment?: boolean;
  scheduledPublishTime?: number;
}
```

`SyncData` 结构：

```ts
interface SyncData {
  platforms: Array<{ name: string; injectUrl?: string; extraConfig?: unknown }>;
  isAutoPublish: boolean;
  data: ArticleData;
}
```

### B. 接收扩展提交的当前页收录

新增 API：

```txt
POST /api/extension/submit
```

请求 payload：

```ts
interface BestBlogsSubmitPayload {
  title: string;
  author: string;
  cover: string;
  content: string;
  digest: string;
  sourceUrl: string;
  sourceTitle: string;
  submittedVia: "multipost-extension";
  extensionVersion: string;
  scrapedAt: string;
}
```

建议响应：

```ts
type SubmitResponse =
  | { success: true; candidateId: string; duplicate?: boolean }
  | { success: false; message: string };
```

建议后端行为：

1. 校验登录态；未登录返回 `401`。
2. 校验 `sourceUrl`、`title`、`content`。
3. 按 canonical URL/source URL 去重。
4. 存入 BestBlogs 候选内容队列。
5. 触发现有 AI 评分/摘要/标签流程，或标记为待处理。

CORS/credentials 注意点：

- 扩展 fetch 使用 `credentials: "include"`。
- 如果 API 和页面同域在 `www.bestblogs.dev`，正常 cookie 即可。
- 如果 API 拆到 `api.bestblogs.dev`，需要确认 cookie domain、SameSite、CORS credentials。

### C. 后端批量分发

先做混合方案：

1. BestBlogs 后端生成待分发任务。
2. BestBlogs 网页登录后拉取待处理任务。
3. 网页调用扩展 `MULTIPOST_EXTENSION_PUBLISH`。
4. 扩展打开各平台发布页并注入内容。
5. 网页/后端记录任务状态。

建议任务表字段：

```ts
interface PublishTask {
  id: string;
  userId: string;
  contentId: string;
  contentType: "ARTICLE" | "DYNAMIC" | "VIDEO" | "PODCAST";
  syncData: unknown;
  status: "PENDING" | "CLAIMED" | "SENT_TO_EXTENSION" | "FAILED" | "DONE";
  errorMessage?: string;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
}
```

建议 API：

```txt
GET /api/extension/publish-tasks?status=PENDING
POST /api/extension/publish-tasks/:id/claim
POST /api/extension/publish-tasks/:id/events
```

无人值守分发暂不建议第一阶段做。扩展里的 `src/background/services/api.ts` 仍是原 MultiPost ping 协议，只会打开后端返回的 URL，不能直接携带 `SyncData` 完成多平台注入。

## 验收清单

- 在 `http://localhost:3000` 页面能收到 `MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS` 响应。
- BestBlogs 页面能展示平台列表。
- BestBlogs 页面能构造 `SyncData` 并打开扩展发布确认窗口。
- 扩展 popup 在一篇公开博客文章页点击“收录当前页”后，BestBlogs 后端创建候选内容。
- 未登录 BestBlogs 时提交收录返回清晰错误。
- 重复提交同一 URL 不产生重复候选内容。
