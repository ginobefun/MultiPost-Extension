# BestBlogs MultiPost Fork

本文记录当前 fork 相对原 MultiPost 的 BestBlogs 定制点，以及本仓库内的调试、验证和部署方式。

## 已落地的扩展侧能力

### 1. 默认信任 BestBlogs 域名

相关文件：

- `src/bestblogs/config.ts`
- `src/background/index.ts`
- `src/contents/extension.ts`

扩展启动时会增量写入以下可信域名：

- `multipost.app`
- `bestblogs.dev`
- `www.bestblogs.dev`
- `*.bestblogs.dev`
- `localhost`
- `127.0.0.1`

这样 BestBlogs 网页可以通过 `window.postMessage` 调用扩展 API。已安装过旧开发版本的浏览器也会自动补齐缺失域名，不需要手动清空 storage。

### 2. Popup 入口改为 BestBlogs 控制面板

相关文件：

- `src/popup/index.tsx`
- `locales/zh_CN/messages.json`
- `locales/en/messages.json`

现在点击扩展图标会显示两个动作：

- 打开发布台：打开 `BESTBLOGS_PUBLISH_URL`
- 收录当前页：抓取当前活动标签页内容并提交给 BestBlogs

### 3. 当前页收录动作

相关文件：

- `src/background/index.ts`
- `src/contents/scraper.ts`
- `src/contents/scraper/default.ts`

新增 runtime action：

```ts
MULTIPOST_EXTENSION_BESTBLOGS_SUBMIT_CURRENT_PAGE
```

执行流程：

1. background 找到当前活动标签页。
2. 向该 tab 发送 `MULTIPOST_EXTENSION_REQUEST_SCRAPER_START`。
3. 复用现有 Readability/custom scraper 得到文章数据。
4. POST 到 `bestblogsSubmitEndpoint` storage 配置；没有配置时使用默认值：

```txt
https://www.bestblogs.dev/api/extension/submit
```

开发环境默认值是：

```txt
http://localhost:3000/api/extension/submit
```

请求会携带 `credentials: "include"`，用于复用用户在 BestBlogs 的登录 cookie。

提交 payload：

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

## 本地调试

不要用 `pnpm build` 做日常开发测试。按项目约定使用：

```bash
pnpm dev
```

然后在 Chrome/Edge 中：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 选择 Load unpacked。
4. 加载 `.plasmo/chrome-mv3-dev`。
5. 打开任意文章页，点击扩展图标。
6. 点击“收录当前页”，观察 popup 状态和 service worker console。

如果要联调本地 BestBlogs，需要在 bestblogs-monorepo 启动 `http://localhost:3000`，并实现：

```txt
POST /api/extension/submit
```

临时改提交 endpoint 可在扩展 storage 中写入：

```ts
bestblogsSubmitEndpoint = "http://localhost:3000/api/extension/submit"
```

## 网页调用扩展 API

BestBlogs 网页侧通过 content script 桥接：

```ts
window.postMessage(
  {
    type: "request",
    traceId: crypto.randomUUID(),
    action: "MULTIPOST_EXTENSION_PLATFORMS",
    data: {},
  },
  "*",
);
```

扩展会回传：

```ts
{
  type: "response",
  traceId: string,
  action: string,
  code: number,
  message: string,
  data: unknown
}
```

后续 BestBlogs 页面发布功能应优先复用已有 action：

- `MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS`
- `MULTIPOST_EXTENSION_PLATFORMS`
- `MULTIPOST_EXTENSION_PUBLISH`
- `MULTIPOST_EXTENSION_BESTBLOGS_SUBMIT_CURRENT_PAGE`

## 打包与部署

开发验证通过后再运行：

```bash
pnpm build
```

Plasmo 会执行 build 和 package，产物用于浏览器扩展发布。发布前建议检查：

1. `pnpm lint`
2. 手动加载生产构建产物。
3. 在 `https://www.bestblogs.dev` 验证网页调用扩展 API。
4. 在真实文章页验证 popup 收录。
5. 确认 `POST /api/extension/submit` 对未登录、已登录、重复提交、抓取失败都有明确响应。

## 暂未改动的部分

`src/background/services/api.ts` 仍保留原 MultiPost 的 ping 协议。BestBlogs 后端批量分发建议先走“网页拉任务 + 调扩展 API”的混合方案；等需要无人值守发布时，再把 ping host 和任务协议迁移到 BestBlogs 后端。
