// Vercel Node Serverless Function — 短视频分享短链解析
// 路由：GET /parse?url=<分享短链>  →  返回 { platform, url, title }
//
// 说明（务必读）：
// 抖音/快手/小红书/视频号 的页面结构、签名、反爬会变化，这里是「best-effort」解析。
// 若某天失效，只需替换 resolve() 里的抽取逻辑，接口不变。
// 仅用于解析你自己有权处理的素材；请遵守各平台服务条款与当地法规。

export const config = { runtime: 'nodejs' };

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
  try { return JSON.parse(s); } catch { try { return JSON.parse(s.replace(/;\s*$/, '').replace(/;$/, '')); } catch { return {}; } }
}

function extractBetween(html, start, end) {
  const i = html.indexOf(start);
  if (i < 0) return null;
  const j = html.indexOf(end, i + start.length);
  return html.slice(i + start.length, j < 0 ? undefined : j);
}

// —— 深度扫描 JSON / HTML，找可播放的视频地址 ——
// 命中规则（按优先级）：
//  1) .mp4/.mov/.webm 后缀直链
//  2) 平台 CDN 域名特征（douyinvod / kuaishouvod / xhscdn / aweme/v1/play 等）
function findVideoUrl(obj, preferMp4 = true) {
  const found = { mp4: null, any: null };
  const pick = (s) => {
    if (!s || typeof s !== 'string' || !/^https?:\/\//i.test(s)) return;
    if (/^(data:|blob:)/i.test(s)) return;
    if (/\.(mp4|mov|webm)(\?|$)/i.test(s)) { if (!found.mp4) found.mp4 = s; if (!found.any) found.any = s; return; }
    if (/douyinvod|kuaishouvod|xhscdn|aweme\/v1\/play|playApi|\/play\/\?|video\/play|manifest|mime_type.*video/i.test(s)) {
      if (!found.any) found.any = s;
    }
  };
  const walk = (o, depth) => {
    if (!o || depth > 60 || (found.mp4 && preferMp4)) return;
    if (typeof o === 'string') { pick(o); return; }
    if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) {
        const v = o[k];
        // 关键字段名直接取值（含 play_addr.url_list 结构）
        if (/playApi|play_addr|playAddr|downloadAddr|download_addr|playUrl|play_url|mainMovier|urlPre|videoUrl|video_url|url_list/i.test(k)) {
          if (typeof v === 'string') pick(v);
          else if (Array.isArray(v)) v.forEach(x => pick(typeof x === 'string' ? x : x && x.url));
          else if (v && typeof v === 'object' && typeof v.url === 'string') pick(v.url);
        }
        walk(v, depth + 1);
      }
    }
  };
  walk(obj, 0);
  return preferMp4 ? (found.mp4 || found.any) : found.any;
}

// 兜底：从 HTML 里扫 meta 标签与裸地址
function findVideoInHtml(html) {
  const metas = html.match(/<meta[^>]+(?:property|name)="(?:og:video(?::url|:secure_url)?|twitter:player:stream)"[^>]+content="([^"]+)"/i);
  if (metas && metas[1]) return metas[1];
  // 页面里任何裸露的视频地址
  const m = html.match(/https?:\/\/[^"'\\\s]+(?:\.mp4|aweme\/v1\/play\/\?[^"'\\\s]*|douyinvod[^"'\\\s]*)/i);
  return m ? m[0] : null;
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

function extractRenderData(html) {
  const m = html.match(/<script id="RENDER_DATA" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// 抖音新版分享页：window._ROUTER_DATA = {...}
function extractRouterData(html) {
  const m = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/);
  if (!m) return null;
  return safeJson(m[1]);
}

async function fetchText(u, extraHeaders) {
  const r = await fetch(u, {
    headers: Object.assign({ 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9' }, extraHeaders || {}),
    redirect: 'follow'
  });
  if (!r.ok) throw new Error('抓取页面失败 HTTP ' + r.status);
  return r.text();
}

async function resolveDouyin(u) {
  // 1) 跟随短链跳转拿真实分享页
  const html = await fetchText(u);

  // 2) 新版 _ROUTER_DATA
  const rd = extractRouterData(html);
  if (rd) {
    const v = findVideoUrl(rd, true);
    if (v) return { platform: 'douyin', url: v, title: getTitle(rd) };
  }
  // 3) 旧版 RENDER_DATA
  const old = extractRenderData(html);
  if (old) {
    const parsed = safeJson(old);
    const v = findVideoUrl(parsed, true);
    if (v) return { platform: 'douyin', url: v, title: getTitle(parsed) };
  }
  // 4) meta / 裸地址兜底
  const bare = findVideoInHtml(html);
  if (bare) return { platform: 'douyin', url: bare };
  return null;
}

async function resolve(inputUrl) {
  const u = inputUrl.trim();
  const platform = detect(u);

  if (platform === 'douyin') {
    const out = await resolveDouyin(u);
    if (out) return out;
  }
  if (platform === 'kuaishou' || platform === 'xhs') {
    const html = await fetchText(u);
    const st = extractBetween(html, 'window.__INITIAL_STATE__=', '</script>');
    if (st) {
      const parsed = safeJson(st);
      const v = findVideoUrl(parsed, true);
      if (v) return { platform, url: v, title: getTitle(parsed) };
    }
    const bare = findVideoInHtml(html);
    if (bare) return { platform, url: bare };
  }
  if (platform === 'shipinhao') {
    const html = await fetchText(u);
    const v = findVideoUrl(safeJson(html), true) || findVideoUrl(safeJson(extractBetween(html, 'window.__INITIAL_STATE__=', '</script>')), true) || findVideoInHtml(html);
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
