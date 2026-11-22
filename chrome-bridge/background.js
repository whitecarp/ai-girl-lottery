function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBiliJson(url) {
  let res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) {
    res = await fetch(url, { credentials: 'include' });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function resolveInputToVideo(rawInput) {
  let text = String(rawInput || '').trim();
  const shortMatch = text.match(/https?:\/\/b23\.tv\/[A-Za-z0-9]+/i);
  if (shortMatch) {
    try {
      const r = await fetch(shortMatch[0], { redirect: 'follow', credentials: 'omit' });
      if (r.url) text = r.url;
    } catch (_) {}
  }

  const bvMatch = text.match(/(BV[0-9A-Za-z]{8,14})/);
  if (bvMatch) {
    const view = await fetchBiliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvMatch[1])}`);
    if (view.code !== 0 || !view.data?.aid) {
      throw new Error(`获取视频信息失败 (${view.code}: ${view.message || 'unknown'})`);
    }
    return {
      bvid: view.data.bvid || bvMatch[1],
      aid: view.data.aid,
      title: view.data.title || '',
    };
  }

  const avMatch = text.match(/(?:^|[^A-Za-z0-9])av(\d+)/i) || text.match(/^(\d{4,})$/);
  if (avMatch) {
    const view = await fetchBiliJson(`https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(avMatch[1])}`);
    if (view.code !== 0 || !view.data?.aid) {
      throw new Error(`获取视频信息失败 (${view.code}: ${view.message || 'unknown'})`);
    }
    return {
      bvid: view.data.bvid || '',
      aid: view.data.aid,
      title: view.data.title || '',
    };
  }

  throw new Error('未能识别 BV 号 / av 号 / B 站链接');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'FETCH_COMMENTS') return false;

  (async () => {
    try {
      const info = await resolveInputToVideo(msg.input || msg.bvid);
      const all = [];
      const seenRpid = new Set();
      let next = 0;
      let page = 0;

      while (page < 60) {
        page += 1;
        const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${info.aid}&mode=2&next=${next}&ps=30`;
        const res = await fetchBiliJson(url);
        if (res.code !== 0) {
          throw new Error(`评论接口返回异常 (${res.code}: ${res.message || 'unknown'})`);
        }
        const d = res.data || {};
        const replies = d.replies || [];
        const pushReply = (item, isSub, parentId) => {
          if (!item || seenRpid.has(item.rpid)) return;
          seenRpid.add(item.rpid);
          const pics = (item.content?.pictures || [])
            .map((p) => String(p?.img_src || '').replace(/^http:\/\//i, 'https://'))
            .filter(Boolean);
          all.push({
            rpid: item.rpid,
            parent: parentId || 0,
            uid: item.member?.mid || 0,
            uname: item.member?.uname || '',
            avatar: String(item.member?.avatar || '').replace(/^http:\/\//i, 'https://'),
            level: item.member?.level_info?.current_level || 0,
            ctime: item.ctime || 0,
            date: new Date((item.ctime || 0) * 1000).toLocaleString('zh-CN', { hour12: false }),
            content: item.content?.message || '',
            pictures: pics,
            isReply: isSub,
          });
        };
        for (const c of replies) {
          pushReply(c, false, 0);
          for (const sub of c.replies || []) {
            pushReply(sub, true, c.rpid);
          }
        }
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'FETCH_PROGRESS',
            message: `正在抓取《${info.title || info.bvid}》第 ${page} 页 · 已获取 ${all.length} 条（含图 ${all.filter((x) => x.pictures.length).length} 条）`,
          });
        }
        if (!d.cursor || d.cursor.is_end || replies.length === 0) break;
        next = d.cursor.next || 0;
        await sleep(320);
      }

      sendResponse({
        ok: true,
        payload: {
          bvid: info.bvid,
          aid: info.aid,
          title: info.title,
          exportedAt: new Date().toISOString(),
          comments: all,
        },
      });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
