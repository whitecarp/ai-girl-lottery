# AI 娘星穹抽奖台 · AI Girl Bilibili Lottery

极简 B 站粉丝抽奖工具：**输入 BV 号 / 视频链接 → 点击「开始抽奖」**，直接由 GPT 娘（及第一期 12 位 AI 娘）主持开奖，同屏直接放大显示**中奖者完整评论原文 + 评论晒图（AI 娘票根）**。

## 为什么纯 GitHub 静态页不能直接抓？怎么变成真正「输入 BV 号直接抽」？

GitHub Pages 只有纯静态文件，浏览器出于安全限制无法直接跨域调用 `https://api.bilibili.com/...`（扩展直接请求若携带 `Origin: chrome-extension://` 也会被 B 站拦截返回 `412`）。

本仓库同时提供三种开箱即用方案（均**无需上传任何 B 站 Cookie**）：

### 方案 A（最省心 · 推荐）：一键部署到 Cloudflare Workers
> 注意：**Cloudflare Pages** 只是静态页，但 **Cloudflare Workers** 可以把前端网页 + 免 Cookie 的 `/api/comments` 接口一起托管（免费版每天 10 万次请求）。

1. 本仓库已内置 [`worker.js`](./worker.js) 与 [`wrangler.jsonc`](./wrangler.jsonc)。
2. 部署一次后，直接打开你自己的 `https://ai-girl-lottery.<子域>.workers.dev`，任何人打开就能直接**贴 BV 号/链接一键开抽**；也可通过 `?api=https://...` 或右上角「⚙ 筛选」绑定到 GitHub Pages。

### 方案 B（本地直接运行零依赖 Node 服务）
```bash
node local-server.mjs
```
浏览器打开 `http://127.0.0.1:8788` 即可直接输入任意 BV 号 / 链接实时拉取评论开奖。

### 方案 C（本地 Chrome/Edge 扩展直连 · 已修复 412）
1. 打开 `chrome://extensions` 或 `edge://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择仓库内的 `chrome-bridge/` 文件夹（如果之前装过旧版，点一下刷新重载，新版通过 `rules.json` 移除了触发 `412` 的扩展 Origin 头）。
3. 回到网页输入 BV 号点「✦ 开始抽奖」即可自动拉取并开奖。

## 12 位 AI 娘完整名单（第一期 · Issue 01）
`01 鲸鱼娘` · `02 Claude 娘` · `03 GPT 娘` · `04 Gemini 娘` · `05 Grok 娘` · `06 Qwen 娘` · `07 Kimi 娘` · `08 GLM 娘` · `09 豆包娘` · `10 Mistral 娘` · `11 Llama 娘` · `12 Suno 娘`
