/**
 * Cloudflare Worker: serves static AI Girl Lottery assets AND proxies
 * public Bilibili comments at GET /api/comments?input=<BV|av|URL|b23.tv>.
 *
 * Includes offline BigInt bv2av conversion so BV -> aid needs zero /view call,
 * plus optional env.BILI_COOKIE Secret support if Cloudflare egress IP hits -412.
 */

const XOR_CODE = 23442827791579n;
const MASK_CODE = 2251799813685247n;
const BASE = 58n;
const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildBiliHeaders(env) {
  const h = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://www.bilibili.com/',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  const cookie = env && typeof env.BILI_COOKIE === 'string' ? env.BILI_COOKIE.trim() : '';
  if (cookie) {
    h.Cookie = cookie;
  }
  return h;
}

function bv2av(bvid) {
  if (!bvid || !/^BV1[0-9A-Za-z]{9}$/.test(bvid)) return null;
  const b = bvid.split('');
  [b[3], b[9]] = [b[9], b[3]];
  [b[4], b[7]] = [b[7], b[4]];
  b.splice(0, 3);
  let tmp = 0n;
  for (const ch of b) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    tmp = tmp * BASE + BigInt(idx);
  }
  return Number((tmp & MASK_CODE) ^ XOR_CODE);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

async function resolveVideoInfo(rawInput, headers) {
  let text = String(rawInput || '').trim();
  const shortMatch = text.match(/https?:\/\/b23\.tv\/[A-Za-z0-9]+/i);
  if (shortMatch) {
    try {
      const r = await fetch(shortMatch[0], { redirect: 'follow', headers });
      if (r.url) text = r.url;
    } catch (_) {}
  }

  let bvid = '';
  let aid = null;
  let title = '';
  let owner = '';

  const bvMatch = text.match(/(BV[0-9A-Za-z]{8,14})/);
  if (bvMatch) {
    bvid = bvMatch[1];
    aid = bv2av(bvid);
  } else {
    const avMatch = text.match(/(?:^|[^A-Za-z0-9])av(\d+)/i) || text.match(/^(\d{4,})$/);
    if (avMatch) {
      aid = Number(avMatch[1]);
    }
  }

  if (!aid) {
    throw new Error('请填写合法的 BV 号、av 号或 B 站视频链接');
  }

  // Best-effort metadata lookup: never fail if Bilibili blocks /view from cloud IP
  try {
    const query = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${encodeURIComponent(aid)}`;
    const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?${query}`, { headers });
    if (viewRes.ok) {
      const view = await viewRes.json();
      if (view && view.code === 0 && view.data) {
        bvid = view.data.bvid || bvid;
        aid = view.data.aid || aid;
        title = view.data.title || '';
        owner = view.data.owner?.name || '';
      }
    }
  } catch (_) {}

  return { bvid, aid, title, owner };
}

async function handleCommentsApi(url, env) {
  const input = url.searchParams.get('input') || url.searchParams.get('bvid') || '';
  if (!input.trim()) {
    return jsonResponse({ ok: false, error: '缺少 input 或 bvid 参数' }, 400);
  }
  const headers = buildBiliHeaders(env);
  try {
    const info = await resolveVideoInfo(input, headers);
    const all = [];
    const seen = new Set();
    let next = 0;
    let page = 0;
    let totalCount = 0;

    while (page < 60) {
      page += 1;
      const apiUrl = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${info.aid}&mode=2&next=${next}&ps=30`;
      const res = await fetch(apiUrl, { headers });
      if (res.status === 412) {
        throw new Error(
          'B 站拦截了 Cloudflare 云端节点 IP（HTTP 412）。可刷新使用本地 chrome-bridge 扩展、双击仓库里的 启动AI娘抽奖台.bat 本地直连，或在 Worker 后台配置 BILI_COOKIE 环境变量。'
        );
      }
      if (!res.ok) throw new Error(`Bilibili HTTP ${res.status}`);
      const data = await res.json();
      if (data.code === -412 || data.code === -352) {
        throw new Error(
          `B 站风控拦截了 Cloudflare 云端节点（${data.code}: ${data.message || 'banned'}）。请刷新使用本地 chrome-bridge 扩展、运行本地 启动AI娘抽奖台.bat，或在 Worker 后台添加 BILI_COOKIE 变量。`
        );
      }
      if (data.code !== 0) {
        throw new Error(`评论接口异常 (${data.code}: ${data.message || 'unknown'})`);
      }
      const d = data.data || {};
      totalCount = d.cursor?.all_count || totalCount;
      const replies = d.replies || [];
      for (const c of replies) {
        if (seen.has(c.rpid)) continue;
        seen.add(c.rpid);
        const pics = (c.content?.pictures || [])
          .map((p) => String(p?.img_src || '').replace(/^http:\/\//i, 'https://'))
          .filter(Boolean);
        all.push({
          rpid: c.rpid,
          uid: c.member?.mid || 0,
          uname: c.member?.uname || '',
          avatar: String(c.member?.avatar || '').replace(/^http:\/\//i, 'https://'),
          level: c.member?.level_info?.current_level || 0,
          ctime: c.ctime || 0,
          date: new Date((c.ctime || 0) * 1000).toLocaleString('zh-CN', {
            hour12: false,
            timeZone: 'Asia/Shanghai',
          }),
          content: c.content?.message || '',
          pictures: pics,
          isReply: false,
        });
      }
      if (!d.cursor || d.cursor.is_end || replies.length === 0) break;
      next = d.cursor.next || 0;
      await sleep(160);
    }

    return jsonResponse({
      ok: true,
      bvid: info.bvid,
      aid: info.aid,
      title: info.title || info.bvid || `av${info.aid}`,
      owner: info.owner,
      totalCount,
      totalFetched: all.length,
      exportedAt: new Date().toISOString(),
      comments: all,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname === '/api/comments') {
      return handleCommentsApi(url, env);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('AI Girl Lottery API Worker Ready', { status: 200, headers: CORS_HEADERS });
  },
};
