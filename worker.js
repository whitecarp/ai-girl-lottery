/**
 * Cloudflare Worker: serves static AI Girl Lottery assets AND proxies
 * public Bilibili comments at GET /api/comments?input=<BV|av|URL|b23.tv>.
 */

const BILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Accept: 'application/json, text/plain, */*',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function resolveVideoInfo(rawInput) {
  let text = String(rawInput || '').trim();
  const shortMatch = text.match(/https?:\/\/b23\.tv\/[A-Za-z0-9]+/i);
  if (shortMatch) {
    try {
      const r = await fetch(shortMatch[0], { redirect: 'follow', headers: BILI_HEADERS });
      if (r.url) text = r.url;
    } catch (_) {}
  }

  const bvMatch = text.match(/(BV[0-9A-Za-z]{8,14})/);
  if (bvMatch) {
    const viewRes = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvMatch[1])}`,
      { headers: BILI_HEADERS }
    );
    const view = await viewRes.json();
    if (view.code !== 0 || !view.data?.aid) {
      throw new Error(`获取视频信息失败 (${view.code}: ${view.message || 'unknown'})`);
    }
    return {
      bvid: view.data.bvid || bvMatch[1],
      aid: view.data.aid,
      title: view.data.title || '',
      owner: view.data.owner?.name || '',
    };
  }

  const avMatch = text.match(/(?:^|[^A-Za-z0-9])av(\d+)/i) || text.match(/^(\d{4,})$/);
  if (avMatch) {
    const viewRes = await fetch(
      `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(avMatch[1])}`,
      { headers: BILI_HEADERS }
    );
    const view = await viewRes.json();
    if (view.code !== 0 || !view.data?.aid) {
      throw new Error(`获取视频信息失败 (${view.code}: ${view.message || 'unknown'})`);
    }
    return {
      bvid: view.data.bvid || '',
      aid: view.data.aid,
      title: view.data.title || '',
      owner: view.data.owner?.name || '',
    };
  }

  throw new Error('请填写合法的 BV 号、av 号或 B 站视频链接');
}

async function handleCommentsApi(url) {
  const input = url.searchParams.get('input') || url.searchParams.get('bvid') || '';
  if (!input.trim()) {
    return jsonResponse({ ok: false, error: '缺少 input 或 bvid 参数' }, 400);
  }
  try {
    const info = await resolveVideoInfo(input);
    const all = [];
    const seen = new Set();
    let next = 0;
    let page = 0;
    let totalCount = 0;

    while (page < 60) {
      page += 1;
      const apiUrl = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${info.aid}&mode=2&next=${next}&ps=30`;
      const res = await fetch(apiUrl, { headers: BILI_HEADERS });
      if (!res.ok) throw new Error(`Bilibili HTTP ${res.status}`);
      const data = await res.json();
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
      title: info.title,
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
      return handleCommentsApi(url);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('AI Girl Lottery API Worker Ready', { status: 200, headers: CORS_HEADERS });
  },
};
