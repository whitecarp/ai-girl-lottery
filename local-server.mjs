#!/usr/bin/env node
/**
 * Zero-dependency local HTTP server for AI Girl Lottery.
 * Serves static site files AND exposes GET /api/comments?input=<BV|URL>
 * using the user's local residential IP (bypasses Bilibili cloud-IP -412 blocks).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);

const XOR_CODE = 23442827791579n;
const MASK_CODE = 2251799813685247n;
const BASE = 58n;
const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const BILI_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(obj));
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

  try {
    const query = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${encodeURIComponent(aid)}`;
    const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?${query}`, { headers: BILI_HEADERS });
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

async function handleApiComments(reqUrl, res) {
  const input = reqUrl.searchParams.get('input') || reqUrl.searchParams.get('bvid') || '';
  if (!input.trim()) {
    sendJson(res, 400, { ok: false, error: '缺少 input 或 bvid 参数' });
    return;
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
      const apiRes = await fetch(apiUrl, { headers: BILI_HEADERS });
      if (!apiRes.ok) throw new Error(`Bilibili HTTP ${apiRes.status}`);
      const data = await apiRes.json();
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
          date: new Date((c.ctime || 0) * 1000).toLocaleString('zh-CN', { hour12: false }),
          content: c.content?.message || '',
          pictures: pics,
          isReply: false,
        });
      }
      if (!d.cursor || d.cursor.is_end || replies.length === 0) break;
      next = d.cursor.next || 0;
      await sleep(160);
    }

    sendJson(res, 200, {
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
    sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
}

export function createLotteryServer() {
  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (reqUrl.pathname === '/api/comments') {
      await handleApiComments(reqUrl, res);
      return;
    }
    const rel = reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname.replace(/^\/+/, '');
    const full = path.resolve(ROOT_DIR, rel);
    if (!full.startsWith(ROOT_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createLotteryServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[AI Girl Lottery Local Server] http://127.0.0.1:${PORT}`);
  });
}
