// Vercel Node Serverless Function — 视频代理转发
// 路由：GET /proxy?url=<视频直链>  →  以 CORS 头回传视频字节
//
// 为什么需要它：抖音/快手等 CDN 通常不带 Access-Control-Allow-Origin，
// 浏览器把视频画到 canvas 后会「污染」，无法逐帧抠图/换背景。
// 经本服务转发并加上 CORS 头，工作台就能正常编辑。
//
// 免费额度注意：Vercel 函数响应有体积限制，过长视频可能超限；
// 如需稳定处理大视频，建议改用 Render/Railway 或 Cloudflare Pages（已支持流式）。

export const config = { runtime: 'nodejs' };

import { Readable } from 'stream';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// 仅允许视频平台域名，避免被当成开放代理滥用
function allowedHost(host) {
  const h = (host || '').toLowerCase();
  const allow = [
    'douyin.com', 'iesdouyin.com', 'douyinvod.com',
    'kuaishou.com', 'gifshow.com', 'kuaishouvod.com',
    'xiaohongshu.com', 'xhscdn.com',
    'weixin.qq.com', 'channels.weixin.qq.com',
    'tiktok.com', 'tiktokcdn.com', 'bytecdn.com', 'volcdn.com'
  ];
  return allow.some(s => h === s || h.endsWith('.' + s));
}

export default async function handler(req, res) {
  const url = (req.query && req.query.url) || '';
  if (!url) { res.statusCode = 400; res.end('missing url'); return; }
  let host;
  try { host = new URL(url).hostname; } catch { res.statusCode = 400; res.end('bad url'); return; }
  if (!allowedHost(host)) { res.statusCode = 403; res.end('host not allowed'); return; }

  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': new URL(url).origin + '/' } });
    if (!r.ok) { res.statusCode = r.status; res.end('upstream ' + r.status); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', r.headers.get('content-type') || 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (r.body && typeof r.body.pipeTo === 'function') {
      Readable.fromWeb(r.body).pipe(res);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.statusCode = 200; res.end(buf);
    }
  } catch (e) {
    res.statusCode = 500; res.end(String(e && e.message ? e.message : e));
  }
}
