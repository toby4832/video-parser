// Vercel Node Serverless Function — 短视频分享短链解析
// 部署：把整个仓库推到 GitHub，到 Vercel「Import」即上线。
// 路由：GET /parse?url=<分享短链>  →  返回 { platform, url, title }
//
// 说明（务必读）：
// 抖音/快手/小红书/视频号 的页面结构、签名、反爬会变化，这里是「best-effort」解析，
// 依赖当前页面内嵌 JSON。若某天失效，只需替换 resolve() 里的抽取逻辑，接口不变。
// 仅用于解析你自己有权处理的素材；请遵守各平台服务条款与当地法规。

export const config = { runtime: 'nodejs20.x' };

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function detect(u) {
  if (/douyin|tiktok/.test(u)) return 'douyin';
  if (/kuaishou|gifshow/.test(u)) return 'kuaishou';
  if (/xiaohongshu|xhslink/.test(u)) return 'xhs';
  if (/weixin|channels/.test(u)) return 'shipinhao';
  return null;
}

function safeJson(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { try { return JSON.parse(s.replace(/;\s*$/, '')); } catch { return {}; } }
}

function extractBetween(html, start, end) {
  const i = html.indexOf(start);
  if (i < 0) return null;
  const j = html.indexOf(end, i + start.length);
  return html.slice(i + start.length, j < 0 ? undefined : j);
}

function extractRenderData(html) {
  const m = html.match(/<script id="RENDER_DATA" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// 深度扫描 JSON，优先返回 .mp4 直链（浏览器原生可播放+可逐帧）
function findVideoUrl(obj, preferMp4 = true) {
  const found = { mp4: null, any: null };
  const walk = (o, depth) => {
    if (!o || depth > 50) return;
    if (typeof o === 'string') {
      if (/^https?:\/\/.+\.(mp4|mov|webm)(\?|$)/i.test(o)) { if (!found.mp4) found.mp4 = o; if (!found.any) found.any = o; }
      else if (/^https?:\/\/.+(douyinvod|kuaishouvod|vod|xhscdn|playApi|manifest)/i.test(o)) { if (!found.any) found.any = o; }
      return;
    }
    if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (/playApi|downloadAddr|playUrl|mainMovier|urlPre|videoUrl|manifest/i.test(k) && typeof v === 'string' && v.startsWith('http')) {
          if (/\.mp4/i.test(v) && !found.mp4) found.mp4 = v;
          if (!found.any) found.any = v;
        }
        walk(v, depth + 1);
      }
    }
  };
  walk(obj, 0);
  return preferMp4 ? (found.mp4 || found.any) : found.any;
}

function getTitle(obj) {
  let t = null;
  const walk = (o, d) => {
    if (!o || d > 40 || t) return;
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (/^(desc|title|caption|note_title)$/i.test(k) && typeof o[k] === 'string' && o[k].length > 1) { t = o[k]; return; }
        walk(o[k], d + 1);
      }
    }
  };
  walk(obj, 0);
  return t;
}

async function fetchText(u) {
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, redirect: 'follow' });
  if (!r.ok) throw new Error('抓取页面失败 HTTP ' + r.status);
  return r.text();
}

async function resolve(inputUrl) {
  const u = inputUrl.trim();
  const platform = detect(u);

  if (platform === 'douyin') {
    const html = await fetchText(u);
    const rd = extractRenderData(html);
    if (rd) {
      const parsed = safeJson(rd);
      const v = findVideoUrl(parsed, true);
      if (v) return { platform, url: v, title: getTitle(parsed) };
    }
  }
  if (platform === 'kuaishou' || platform === 'xhs') {
    const html = await fetchText(u);
    const st = extractBetween(html, 'window.__INITIAL_STATE__=', '</script>');
    if (st) {
      const parsed = safeJson(st);
      const v = findVideoUrl(parsed, true);
      if (v) return { platform, url: v, title: getTitle(parsed) };
    }
  }
  if (platform === 'shipinhao') {
    const html = await fetchText(u);
    const v = findVideoUrl(safeJson(html), true) || findVideoUrl(safeJson(extractBetween(html, 'window.__INITIAL_STATE__=', '</script>')), true);
    if (v) return { platform, url: v };
  }
  // 兜底：输入本身就是直链
  if (/\.(mp4|mov|webm)(\?|$)/i.test(u)) return { platform: platform || 'direct', url: u };
  throw new Error('未能解析到视频直链（平台结构可能已变，或需要登录/签名）');
}

export default async function handler(req, res) {
  const url = (req.query && req.query.url) || '';
  if (!url) { res.status(400).json({ error: '缺少 url 参数' }); return; }
  try {
    const out = await resolve(url);
    if (!out || !out.url) { res.status(404).json({ error: '未解析到视频直链' }); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
