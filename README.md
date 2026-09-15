# video-parser · 短视频链接解析 + 视频代理

把抖音 / 快手 / 小红书 / 视频号 的**分享短链**解析成可直接播放的视频直链，
并通过自带**CORS 代理**转发视频字节，让浏览器端工具（如「素材替换工作台」）能逐帧编辑。

> 这是一个 **Serverless Function**（无服务器函数），不是静态页面——
> GitHub Pages 跑不了它，需要连到支持「从 GitHub 一键部署」的平台。

---

## 一、部署到 GitHub（以 Vercel 为例，全程免费、无需信用卡）

1. 把本仓库推到你的 GitHub（新建一个仓库，例如 `video-parser`）：

   ```bash
   git init
   git add .
   git commit -m "feat: 短视频解析 + 代理"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/video-parser.git
   git push -u origin main
   ```

2. 打开 https://vercel.com → 用 GitHub 登录 → **Add New → Project** → 选中 `video-parser` → 直接 **Deploy**。
   - 无需任何配置，`api/parse.js` 和 `api/proxy.js` 会被自动识别为函数。
   - 部署完会得到一个域名，例如 `https://video-parser-xxx.vercel.app`

3. 记下这个域名，填进工作台的「解析/代理服务地址」。

### 其他可选平台（同样从 GitHub 部署）
- **Netlify**：新建 Site from Git，Build command 留空、Publish directory 留空即可（函数放在 `netlify/functions`，如需可改目录）。
- **Cloudflare Pages**：连 GitHub 仓库，Build 留空；把函数放进 `functions/` 并改写为 `_request` 风格（本仓库是 Vercel 风格，Cloudflare 需小改）。

---

## 二、接口说明

### `GET /parse?url=<分享短链>`
返回 JSON：
```json
{ "platform": "douyin", "url": "https://v26-...douyinvod.com/...", "title": "源头工厂..." }
```
- 抖音：解析页面内 `RENDER_DATA` 中的 `playApi`（无水印播放地址，可能带签名/会过期）。
- 快手 / 小红书：解析 `window.__INITIAL_STATE__` 中的视频地址。
- 视频号：best-effort，结构受限时可能失败。

### `GET /proxy?url=<视频直链>`
以 `Access-Control-Allow-Origin: *` 回传视频字节，解除浏览器跨域限制。
仅允许白名单内的视频平台域名（防滥用）。

---

## 三、在工作台里使用
1. 工作台第①步切到「视频链接」。
2. 「解析/代理服务地址」填入部署后的域名，例如 `https://video-parser-xxx.vercel.app`。
3. 粘贴抖音/快手等分享短链 → 点「解析并加载」→ 自动解析直链并经代理加载 → 第②步抽关键帧即可逐帧编辑。

---

## 四、重要须知 / 限制
- **平台结构会变**：抖音/快手等的签名、反爬、内嵌 JSON 字段会调整，解析失效时只需改 `api/parse.js` 的 `resolve()`，接口不变。
- **免费额度 / 体积**：Vercel 函数响应有体积上限，过长视频经 `/proxy` 可能超限；大视频建议自托管（Render / Railway 或 Cloudflare Pages 流式）。
- **合规**：仅解析你有权处理的素材；遵守各平台服务条款与当地法律法规，复刻内容请保持原创、并按规定标注 AI 生成。
