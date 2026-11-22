function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'FETCH_COMMENTS') return false;

  (async () => {
    try {
      const bvid = msg.bvid;
      const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
      if (view.code !== 0 || !view.data?.aid) {
        throw new Error(`获取视频信息失败 (${view.code}: ${view.message || 'unknown'})`);
      }
      const aid = view.data.aid;
      const all = [];
      let next = 0;
      let page = 0;

      while (true) {
        page += 1;
        const url = `https://api.bilibili.com/x/v2/reply/main?csrf=&type=1&oid=${aid}&mode=2&next=${next}&ps=30`;
        const res = await fetchJson(url);
        if (res.code !== 0) {
          throw new Error(`评论接口返回异常 (${res.code}: ${res.message || 'unknown'})`);
        }
        const d = res.data || {};
        const replies = d.replies || [];
        for (const c of replies) {
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
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'FETCH_PROGRESS',
            message: `已抓取 ${bvid} 第 ${page} 页 · 共 ${all.length} 条（含图 ${all.filter((x) => x.pictures.length).length} 条）`,
          });
        }
        if (!d.cursor || d.cursor.is_end || replies.length === 0) break;
        next = d.cursor.next || 0;
        await sleep(380);
      }

      sendResponse({ ok: true, payload: { bvid, aid, exportedAt: new Date().toISOString(), comments: all } });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
