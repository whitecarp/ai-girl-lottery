(function () {
  'use strict';

  // Canonical 12 AI Girls matching fan-milestone-ticket-toy-20261122/tools/build_assets.py
  const AI_GIRLS = [
    { id: 'c01', name: '鲸鱼娘', title: '星海守望' },
    { id: 'c02', name: 'Claude 娘', title: '向日葵书卷' },
    { id: 'c03', name: 'GPT 娘', title: '白龙礼服' },
    { id: 'c04', name: 'Gemini 娘', title: '星穹双子' },
    { id: 'c05', name: 'Grok 娘', title: '炎斧骑士' },
    { id: 'c06', name: 'Qwen 娘', title: '青花剑姬' },
    { id: 'c07', name: 'Kimi 娘', title: '星夜琴师' },
    { id: 'c08', name: 'Cursor 娘', title: '光标暗影' },
    { id: 'c09', name: '豆包娘', title: '赤枪先锋' },
    { id: 'c10', name: 'Mistral 娘', title: '金羽剑圣' },
    { id: 'c11', name: 'Llama 娘', title: '银风游侠' },
    { id: 'c12', name: 'Suno 娘', title: '竖琴缪斯' },
  ];

  const API_STORAGE_KEY = 'ai_girl_lottery_api_base';
  const $ = (id) => document.getElementById(id);

  const state = {
    mcIdx: 2, // 03 GPT 娘
    awaken: false,
    sfxOn: true,
    bvid: '',
    videoTitle: '',
    isDemo: false,
    rawComments: [],
    voidUids: new Set(),
    wonUids: new Set(),
    winners: [],
    rolling: false,
    fetching: false,
    drawAfterFetch: false,
    bridgeReady: false,
    poolOpen: false,
    apiBase: '',
  };

  function initStarCanvas() {
    const canvas = $('star-canvas');
    const ctx = canvas.getContext('2d');
    let stars = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 80 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.4,
        a: Math.random() * 0.65 + 0.25,
        s: Math.random() * 0.14 + 0.04,
        color: Math.random() > 0.72 ? '#38f2ad' : Math.random() > 0.5 ? '#f5d27a' : '#dceaff',
      }));
    }
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        st.y -= st.s;
        if (st.y < -4) st.y = canvas.height + 4;
        ctx.globalAlpha = st.a;
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    window.addEventListener('resize', resize);
    resize();
    tick();
  }

  let audioCtx = null;
  function playChime(type) {
    if (!state.sfxOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const playTone = (freq, dur, delay, gainVal) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type === 'win' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(gainVal, now + delay + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + dur + 0.02);
      };
      if (type === 'tick') {
        playTone(660 + Math.random() * 260, 0.055, 0, 0.045);
      } else if (type === 'win') {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => playTone(f, 0.45, idx * 0.07, 0.09));
      }
    } catch (_) {}
  }

  function secureRandomInt(max) {
    if (max <= 1) return 0;
    const range = 0x100000000;
    const limit = range - (range % max);
    const buf = new Uint32Array(1);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % max;
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizePicUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/^http:\/\//i, 'https://');
  }

  function extractVideoToken(raw) {
    const text = String(raw || '').trim();
    const bv = text.match(/(BV[0-9A-Za-z]{8,14})/);
    if (bv) return { kind: 'bv', token: bv[1], raw: text };
    const av = text.match(/(?:^|[^A-Za-z0-9])av(\d+)/i) || text.match(/^(\d{4,})$/);
    if (av) return { kind: 'av', token: `av${av[1]}`, raw: text };
    if (/b23\.tv\/[A-Za-z0-9]+/i.test(text)) return { kind: 'short', token: text, raw: text };
    return null;
  }

  function setStatus(text, tone = '') {
    const el = $('status-bar');
    el.textContent = text;
    el.className = 'status-text' + (tone ? ' ' + tone : '');
  }

  function renderMcStage(speechText) {
    const g = AI_GIRLS[state.mcIdx];
    const num = String(state.mcIdx + 1).padStart(2, '0');
    const form = state.awaken ? 'awaken' : 'base';
    $('mc-portrait').src = `./assets/cards/${g.id}_${form}.webp`;
    $('mc-portrait').alt = `${g.name}（${state.awaken ? '觉醒形态' : '基础形态'}）`;
    $('mc-dlg-who').textContent = `${num} · ${g.name}`;

    const badge = $('mc-form-badge');
    const frame = $('mc-frame');
    if (state.awaken) {
      badge.textContent = '★ 铁粉烫金觉醒';
      badge.classList.add('awakened');
      frame.classList.add('awakened');
      $('btn-toggle-awaken').textContent = '切回基础';
    } else {
      badge.textContent = '● 基础形态';
      badge.classList.remove('awakened');
      frame.classList.remove('awakened');
      $('btn-toggle-awaken').textContent = '切换觉醒';
    }
    frame.classList.toggle('rolling', state.rolling);
    $('mc-select').value = String(state.mcIdx);

    if (speechText) $('mc-speech').textContent = speechText;
  }

  function initMcAndRibbon() {
    $('mc-select').innerHTML = AI_GIRLS.map(
      (g, i) => `<option value="${i}">${String(i + 1).padStart(2, '0')} · ${g.name}</option>`
    ).join('');

    $('ribbon-12').innerHTML = AI_GIRLS.map(
      (g, i) => `
        <div class="rib-card" data-idx="${i}" title="切换 ${g.name} 主持">
          <img src="./assets/cards/${g.id}_awaken.webp" alt="${g.name}" loading="lazy" />
          <span>${String(i + 1).padStart(2, '0')} ${g.name}</span>
        </div>`
    ).join('');

    $('mc-select').addEventListener('change', (e) => {
      state.mcIdx = Number(e.target.value);
      const g = AI_GIRLS[state.mcIdx];
      renderMcStage(`本小姐【${g.name}】接管开奖台啦，贴好 BV 号点「开始抽奖」就行！`);
    });

    $('ribbon-12').addEventListener('click', (e) => {
      const card = e.target.closest('[data-idx]');
      if (!card) return;
      state.mcIdx = Number(card.dataset.idx);
      const g = AI_GIRLS[state.mcIdx];
      renderMcStage(`本小姐【${g.name}】接管开奖台啦，准备揭晓幸运评论～`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function getFilteredPool() {
    const picsOnly = $('chk-pics-only').checked;
    const dedupe = $('chk-dedupe').checked;
    const rootOnly = $('chk-root-only').checked;
    const minLevel = Number($('sel-level').value || 0);
    const keyword = $('input-keyword').value.trim().toLowerCase();
    const cutoffStr = $('input-cutoff').value;
    const cutoffMs = cutoffStr ? new Date(cutoffStr).getTime() : null;

    const seenUid = new Set();
    const out = [];
    for (const item of state.rawComments) {
      if (rootOnly && item.isReply) continue;
      if (picsOnly && (!Array.isArray(item.pictures) || item.pictures.length === 0)) continue;
      if (minLevel > 0 && (item.level || 0) < minLevel) continue;
      if (keyword && !String(item.content || '').toLowerCase().includes(keyword)) continue;
      if (cutoffMs && item.ctime && item.ctime * 1000 > cutoffMs) continue;
      const uidStr = String(item.uid);
      if (dedupe) {
        if (seenUid.has(uidStr)) continue;
        seenUid.add(uidStr);
      }
      out.push(item);
    }
    return out;
  }

  function updatePoolUi() {
    const pool = getFilteredPool();
    const drawable = pool.filter((c) => !state.voidUids.has(String(c.uid)) && !state.wonUids.has(String(c.uid)));
    const hasComments = state.rawComments.length > 0;

    $('pool-count').textContent = pool.length;
    $('pop-pool-count').textContent = pool.length;
    $('pool-count-head').textContent = pool.length;

    $('btn-toggle-pool').classList.toggle('hidden', !hasComments);
    $('btn-refresh-comments').classList.toggle('hidden', !hasComments || state.isDemo || !state.bvid);
    $('btn-reset-winners').classList.toggle('hidden', state.winners.length === 0);

    if (hasComments) {
      const rootsCount = state.rawComments.filter((c) => !c.isReply).length;
      const subsCount = state.rawComments.length - rootsCount;
      const picsTotal = state.rawComments.filter((c) => Array.isArray(c.pictures) && c.pictures.length > 0).length;
      const titlePart = state.videoTitle ? `《${state.videoTitle}》· ` : '';
      const subText = subsCount > 0 ? ` + ${subsCount} 条楼中楼` : '';
      setStatus(
        `${titlePart}共 ${rootsCount} 条一楼${subText}（带图 ${picsTotal} 条）· 当前有效奖池 ${drawable.length} 人`,
        'ok'
      );
    }

    if (!state.rolling && state.winners.length === 0 && hasComments) {
      $('spot-heading').textContent = `奖池就绪：${drawable.length} 位有效参与者`;
    }

    renderPoolList(pool);
  }

  function renderPoolList(pool) {
    const q = $('input-search-pool').value.trim().toLowerCase();
    const filtered = q
      ? pool.filter(
          (c) =>
            String(c.uname || '').toLowerCase().includes(q) ||
            String(c.uid || '').includes(q) ||
            String(c.content || '').toLowerCase().includes(q)
        )
      : pool;

    const listEl = $('pool-list');
    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:#98abc7;font-size:13px;padding:10px;">暂无符合当前过滤条件的评论。</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .slice(0, 240)
      .map((c) => {
        const isVoid = state.voidUids.has(String(c.uid));
        const picsHtml = (c.pictures || [])
          .slice(0, 3)
          .map(
            (src) =>
              `<img class="cand-thumb" src="${escapeHtml(src)}" referrerpolicy="no-referrer" alt="评论图" data-zoom="${escapeHtml(src)}" data-cap="${escapeHtml(c.uname + '：' + c.content)}" />`
          )
          .join('');
        return `
          <div class="cand-card ${isVoid ? 'voided' : ''}">
            <img class="cand-av" src="${escapeHtml(c.avatar || './assets/icons/crest_follow.webp')}" referrerpolicy="no-referrer" alt="" />
            <div class="cand-body">
              <div class="cand-top">
                <span class="cand-name">${escapeHtml(c.uname)}${isVoid ? '（已作废）' : ''}</span>
                <span class="cand-lv">Lv${c.level || 0} · ${escapeHtml(c.uid)}</span>
              </div>
              <div class="cand-msg">${escapeHtml(c.content || '（纯图片评论）')}</div>
              ${picsHtml ? `<div class="cand-thumbs">${picsHtml}</div>` : ''}
            </div>
          </div>`;
      })
      .join('');
  }

  function buildCommentJumpUrl(w) {
    if (state.bvid && !state.isDemo && w.rpid) {
      return `https://www.bilibili.com/video/${encodeURIComponent(state.bvid)}/#reply${encodeURIComponent(w.rpid)}`;
    }
    return `https://space.bilibili.com/${encodeURIComponent(w.uid)}`;
  }

  function renderWinners() {
    if (state.winners.length === 0) {
      $('spot-heading').textContent = state.rawComments.length > 0 ? '奖池已就绪，点击「开始抽奖」' : '等待开奖……';
      $('spotlight-body').innerHTML = `
        <div class="empty-stage">
          <div class="empty-icon">✦</div>
          <div class="empty-title">输 BV 号 / 链接，一点直接抽出中奖评论与票根大图</div>
          <div class="empty-sub">默认只抽带图一楼防吞评并按 UID 去重；不强制转发，中奖者评论文字与配图同屏直显。</div>
          <div class="empty-cta">
            <button id="btn-empty-demo" class="btn btn-soft" type="button">✨ 先用演示数据试抽一下</button>
            <button id="btn-empty-import" class="btn btn-ghost" type="button">📥 导入 JSON / 本地抓评</button>
          </div>
        </div>`;
      return;
    }

    $('spot-heading').textContent = `✦ 开奖结果：恭喜 ${state.winners.length} 位中奖铁粉！`;
    const html = state.winners
      .map((w, idx) => {
        const picsHtml =
          w.pictures && w.pictures.length
            ? w.pictures
                .map(
                  (src) =>
                    `<img class="win-pic-thumb" src="${escapeHtml(src)}" referrerpolicy="no-referrer" alt="中奖者评论晒图" data-zoom="${escapeHtml(src)}" data-cap="${escapeHtml(w.uname + '（UID ' + w.uid + '）的评论晒图')}" />`
                )
                .join('')
            : `<div class="win-no-pic">⚠ 该条评论未附带图片</div>`;

        return `
          <div class="winner-card">
            <div class="win-top">
              <div class="win-user">
                <img class="win-avatar" src="${escapeHtml(w.avatar || './assets/icons/crest_iron.webp')}" referrerpolicy="no-referrer" alt="" />
                <div>
                  <span class="win-badge">WINNER #${idx + 1} · 可核验中奖楼层</span>
                  <div class="win-uname">${escapeHtml(w.uname)}</div>
                  <div class="win-meta">UID: ${escapeHtml(w.uid)} · Lv.${w.level || 0} · ${escapeHtml(w.date || '')}</div>
                </div>
              </div>
              <div class="win-actions">
                <a class="btn btn-emerald btn-sm" href="${escapeHtml(buildCommentJumpUrl(w))}" target="_blank" rel="noopener">🔗 直达原评论</a>
                <a class="btn btn-gold btn-sm" href="https://space.bilibili.com/${escapeHtml(w.uid)}" target="_blank" rel="noopener">👤 查主页</a>
                <button class="btn btn-ghost btn-sm" type="button" data-copy-win="${idx}">📋 复制公示</button>
                <button class="btn btn-danger btn-sm" type="button" data-void-win="${idx}">🔄 作废重抽</button>
              </div>
            </div>

            <div class="win-content-grid">
              <div class="win-comment-box">
                <div class="win-comment-label">💬 中奖者完整评论原文</div>
                <div class="win-comment-text">${escapeHtml(w.content || '（该用户仅发送了图片评论）')}</div>
              </div>
              <div class="win-pics-box">
                <div class="win-comment-label">🖼️ 评论晒图 / AI 娘票根（点击放大）</div>
                <div class="win-pics-grid">${picsHtml}</div>
              </div>
            </div>
          </div>`;
      })
      .join('');

    $('spotlight-body').innerHTML = `<div class="winner-list">${html}</div>`;
  }

  async function runDraw(drawCount, isReplacement = false) {
    const pool = getFilteredPool().filter(
      (c) => !state.voidUids.has(String(c.uid)) && !state.wonUids.has(String(c.uid))
    );
    if (pool.length === 0) {
      setStatus('当前有效奖池为空，请放宽「⚙ 筛选」条件或清空重抽。', 'err');
      renderMcStage('哎呀，有效奖池没有剩余参与者了，点右上角「⚙ 筛选」看看条件吧～');
      return;
    }

    const targetCount = Math.min(drawCount, pool.length);
    state.rolling = true;
    state.awaken = true;
    $('btn-go').disabled = true;
    $('btn-go-label').textContent = '抽签揭晓中...';
    renderMcStage(`觉醒时刻！正在从 ${pool.length} 位铁粉中锁定中奖评论……`);

    const steps = 16;
    for (let s = 0; s < steps; s++) {
      const sample = pool[secureRandomInt(pool.length)];
      $('spot-heading').textContent = isReplacement ? '✦ 作废补抽中...' : '✦ 星穹命运纺轮运转中...';
      $('spotlight-body').innerHTML = `
        <div class="roulette-box">
          <img class="rl-avatar" src="${escapeHtml(sample.avatar || './assets/icons/crest_follow.webp')}" referrerpolicy="no-referrer" alt="" />
          <div>
            <div class="rl-name">${escapeHtml(sample.uname)}</div>
            <div class="rl-uid">UID ${escapeHtml(sample.uid)} · Lv.${sample.level || 0}</div>
            <div class="rl-snippet">${escapeHtml((sample.content || '（附带评论晒图）').slice(0, 72))}</div>
          </div>
        </div>`;
      playChime('tick');
      const delayMs = 40 + Math.round((s / steps) * (s / steps) * 165);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const localPool = pool.slice();
    const picked = [];
    for (let k = 0; k < targetCount; k++) {
      const idx = secureRandomInt(localPool.length);
      const chosen = localPool.splice(idx, 1)[0];
      state.wonUids.add(String(chosen.uid));
      picked.push(chosen);
    }

    state.winners = [...state.winners, ...picked];
    state.rolling = false;
    $('btn-go').disabled = false;
    $('btn-go-label').textContent = '再抽一位';
    playChime('win');

    const names = picked.map((p) => `【${p.uname}】`).join('、');
    renderMcStage(`恭喜 ${names} 中奖！完整评论与晒图已经在右侧展开，可以直接核验主页关注～`);
    renderWinners();
    updatePoolUi();
    $('rng-proof').textContent = `${new Date().toLocaleTimeString()} · 有效池 ${pool.length} 人 · CSPRNG`;
  }

  function normalizeImportedPayload(raw, isDemo = false) {
    let arr = [];
    let bvid = '';
    let title = '';
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (raw && typeof raw === 'object') {
      bvid = String(raw.bvid || '');
      title = String(raw.title || '');
      arr = raw.comments || raw.replies || raw.list || raw.items || [];
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('没有找到有效评论数据');
    }

    const normalized = arr
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const uid = item.uid ?? item.id ?? item.member?.mid ?? 0;
        const uname = item.uname ?? item.user_name ?? item.member?.uname ?? `UID_${uid}`;
        const avatar = normalizePicUrl(item.avatar ?? item.member?.avatar ?? '');
        const level = Number(item.level ?? item.member?.level_info?.current_level ?? 0);
        const ctime = Number(item.ctime ?? 0);
        const date = item.date ?? (ctime ? new Date(ctime * 1000).toLocaleString('zh-CN', { hour12: false }) : '');
        const content = item.content?.message ?? item.content ?? '';
        const rawPics = item.pictures ?? item.content?.pictures ?? [];
        const pictures = (Array.isArray(rawPics) ? rawPics : [])
          .map((p) => normalizePicUrl(typeof p === 'string' ? p : p?.img_src || p?.url || ''))
          .filter(Boolean);
        return {
          rpid: item.rpid ?? item.reply_id ?? 0,
          uid,
          uname,
          avatar,
          level,
          ctime,
          date,
          content: String(content),
          pictures,
          isReply: Boolean(item.isReply || (item.parent && Number(item.parent) > 0)),
        };
      })
      .filter((x) => x && x.uid);

    if (normalized.length === 0) {
      throw new Error('未能解析出有效评论条目');
    }

    state.bvid = bvid;
    state.videoTitle = title;
    state.isDemo = isDemo;
    if (bvid) $('input-bvid').value = bvid;
    state.rawComments = normalized;
    state.voidUids.clear();
    state.wonUids.clear();
    state.winners = [];
    state.awaken = false;
    $('btn-go-label').textContent = '开始抽奖';
    renderWinners();
    updatePoolUi();
  }

  function loadDemoDataset(andDraw = false) {
    const nowSec = Math.floor(Date.now() / 1000);
    const demoNames = [
      '白龙守望者_Luo', '凌晨三点写Codex', 'Claude向日葵书童', '星穹代码猫',
      'GPT的银发发卡', 'Grok战斧狂想', 'Qwen青花剑客', 'Kimi夜曲不熬夜',
      'Cursor补全侠', '豆包红巾盾卫', 'Mistral法棍骑士', 'Llama银风游侠',
      'Suno竖琴缪斯', '纯文字路人甲', '只吹彩虹屁乙', '忘记传图丙',
      '双倍好运小鲸鱼', '四万粉铁粉老王'
    ];
    const demoTexts = [
      '四万粉恭喜！！刚在专属小玩具里三连觉醒了 GPT 娘，许愿带走 Codex Pro 100！',
      '晒我的黄金觉醒票根！每天追更 AI 娘小剧场，希望 Codex 帮我自动跑全套测试～',
      '实名羡慕这期大奖！点亮大肥鱼换装特辑觉醒了 Claude 娘，附带热乎票根图防吞评！',
      '分母报到！已经关注两年半了，带一张刚刚保存的高清星穹票根来接好运！',
      '为了白龙黑蕾丝觉醒形态来的！晒出我的 01-400108 编号票根，许愿 Codex Pro 100！',
      'Grok 娘重斧造型太帅了吧！附高清觉醒卡面，希望抽中写个小工具～',
      '带图防吞评！青花剑姬 Qwen 娘质感无敌，四万粉冲向十万粉！！',
      '来接欧气啦～刚好需要大上下文写工作流，附上烫金 Kimi 娘票根！',
      'Cursor 娘青光双刃觉醒绝了！配一句正常聊天防止阿 B 吞评，祝视频大爆！',
      '已关注已三连！豆包娘冲冲冲，希望把一个月 Codex Pro 100 抱回家！',
      'Mistral 娘法棍圣剑报道！这张觉醒图必须塞进评论区，冲鸭四万粉～',
      'Llama 娘银风游侠到手，附图防吞评 + 许愿 Codex！',
      'Suno 娘竖琴女神来沾沾喜气，祝 UP 主越做越好！',
      '纯文字路过抽个奖（无配图，会被“仅抽带图”自动过滤）',
      '重在参与！支持一下（无配图对照）',
      '来了来了（无配图对照）',
      '补充一张大号觉醒鲸鱼娘票根！每天都在等 AiGO 更新～',
      '老粉打卡了！刚存了高清烫金票根，希望能中一次 Codex Pro 100！'
    ];

    const comments = demoNames.map((uname, i) => {
      const hasPic = i < 13 || i >= 16;
      const cardNum = String((i % 12) + 1).padStart(2, '0');
      return {
        rpid: 900001000 + i * 7,
        uid: 40010000 + i * 137,
        uname,
        avatar: `./assets/cards/c${cardNum}_base.webp`,
        level: 3 + (i % 4),
        ctime: nowSec - (20 - i) * 3600,
        date: new Date((nowSec - (20 - i) * 3600) * 1000).toLocaleString('zh-CN', { hour12: false }),
        content: demoTexts[i],
        pictures: hasPic ? [`./assets/cards/c${cardNum}_awaken.webp`] : [],
        isReply: false,
      };
    });

    normalizeImportedPayload({ bvid: 'BV140kDemo888', title: '40,000 粉抽奖演示数据', comments }, true);
    renderMcStage('已载入 18 条演示评论（其中 15 条带图防吞评）～点「开始抽奖」直接看大屏揭晓效果！');
    if (andDraw) {
      const n = Math.max(1, Math.min(10, parseInt($('input-draw-count').value || '1', 10) || 1));
      runDraw(n, false);
    }
  }

  function getApiEndpoint(rawInput) {
    const base = state.apiBase.trim().replace(/\/+$/, '');
    if (base) {
      return `${base}/api/comments?input=${encodeURIComponent(rawInput)}`;
    }
    const host = location.hostname;
    const isStaticHost = location.protocol === 'file:' || host.endsWith('.github.io');
    if (!isStaticHost) {
      return `./api/comments?input=${encodeURIComponent(rawInput)}`;
    }
    return null;
  }

  async function fetchAndDraw(forceRefetch = false) {
    if (state.rolling || state.fetching) return;

    const rawInput = $('input-bvid').value.trim();
    const n = Math.max(1, Math.min(10, parseInt($('input-draw-count').value || '1', 10) || 1));
    const parsed = extractVideoToken(rawInput);

    // If user didn't change target and comments are already loaded, draw right away!
    const sameLoaded =
      state.rawComments.length > 0 &&
      !forceRefetch &&
      (!rawInput || (parsed && state.bvid && parsed.token.toLowerCase() === state.bvid.toLowerCase()));
    if (sameLoaded) {
      runDraw(n, false);
      return;
    }

    if (!parsed) {
      if (state.rawComments.length > 0 && !forceRefetch) {
        runDraw(n, false);
        return;
      }
      setStatus('⚠ 请输入有效的 BV 号（如 BV1Eaxt6LEhb）或 B 站视频链接，或点右上角「试抽演示」。', 'err');
      $('input-bvid').focus();
      return;
    }

    const endpoint = getApiEndpoint(rawInput);
    if (endpoint) {
      state.fetching = true;
      $('btn-go').disabled = true;
      $('btn-go-label').textContent = '正在拉取评论...';
      setStatus(`正在通过接口拉取 ${parsed.token} 评论与晒图，请稍候...`);
      try {
        const res = await fetch(endpoint);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) {
          throw new Error((data && data.error) || `HTTP ${res.status}`);
        }
        normalizeImportedPayload(data, false);
        state.fetching = false;
        $('btn-go').disabled = false;
        await runDraw(n, false);
        return;
      } catch (err) {
        state.fetching = false;
        $('btn-go').disabled = false;
        $('btn-go-label').textContent = '开始抽奖';
        if (!state.bridgeReady) {
          setStatus(`❌ 拉取失败：${err.message}`, 'err');
          $('connect-modal').classList.remove('hidden');
          return;
        }
      }
    }

    if (state.bridgeReady) {
      state.fetching = true;
      state.drawAfterFetch = true;
      $('btn-go').disabled = true;
      $('btn-go-label').textContent = '正在直连抓评...';
      setStatus(`正在通过本地浏览器扩展拉取 ${parsed.token} 评论...`);
      window.postMessage(
        { source: 'ai-girl-lottery-page', type: 'FETCH_COMMENTS', input: rawInput, bvid: parsed.kind === 'bv' ? parsed.token : '' },
        '*'
      );
      return;
    }

    $('connect-modal').classList.remove('hidden');
  }

  // Fallback self-contained bookmarklet / console script for offline static pages
  const GRABBER_SOURCE = `(async()=>{try{const m=location.href.match(/(BV[0-9A-Za-z]+)/);if(!m){alert('请先在 B 站视频页打开');return;}const bvid=m[1];const v=await fetch('https://api.bilibili.com/x/web-interface/view?bvid='+bvid,{credentials:'include'}).then(r=>r.json());if(v.code!==0||!v.data?.aid){alert('获取 AID 失败');return;}const aid=v.data.aid;const title=v.data.title||'';const box=document.createElement('div');box.style.cssText='position:fixed;right:20px;bottom:20px;z-index:999999;background:#09101f;color:#e8fff5;border:2px solid #f5d27a;border-radius:14px;padding:16px 20px;font-family:sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.7)';box.innerHTML='<div style="font-weight:900;color:#f5d27a;margin-bottom:6px">✦ AI 娘抓评器 · '+bvid+'</div><div id="ai-g-st" style="font-size:13px">抓取中...</div>';document.body.appendChild(box);const all=[];const seen=new Set();const pushR=(c,sub,pid)=>{if(!c||seen.has(c.rpid))return;seen.add(c.rpid);all.push({rpid:c.rpid,parent:pid||0,uid:c.member?.mid||0,uname:c.member?.uname||'',avatar:String(c.member?.avatar||'').replace(/^http:\\/\\//i,'https://'),level:c.member?.level_info?.current_level||0,ctime:c.ctime||0,date:new Date((c.ctime||0)*1000).toLocaleString('zh-CN',{hour12:false}),content:c.content?.message||'',pictures:(c.content?.pictures||[]).map(p=>String(p?.img_src||'').replace(/^http:\\/\\//i,'https://')).filter(Boolean),isReply:sub});};let next=0,page=0;while(page<60){page++;const res=await fetch('https://api.bilibili.com/x/v2/reply/main?type=1&oid='+aid+'&mode=2&next='+next+'&ps=30',{credentials:'include'}).then(r=>r.json());if(res.code!==0)break;const d=res.data||{};const reps=d.replies||[];for(const c of reps){pushR(c,false,0);for(const s of(c.replies||[]))pushR(s,true,c.rpid);}box.querySelector('#ai-g-st').textContent='第 '+page+' 页 · 已抓 '+all.length+' 条';if(!d.cursor||d.cursor.is_end||reps.length===0)break;next=d.cursor.next||0;await new Promise(r=>setTimeout(r,380));}const blob=new Blob([JSON.stringify({bvid,aid,title,comments:all},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bili_comments_'+bvid+'.json';a.click();box.querySelector('#ai-g-st').textContent='✔ 完成！共 '+all.length+' 条，把 JSON 拖回抽奖台即可开抽。';setTimeout(()=>box.remove(),8000);}catch(e){alert('抓取失败:'+e.message);}})();`;

  function setupBridgeAndGrabber() {
    $('bookmarklet-link').href = 'javascript:' + encodeURIComponent(GRABBER_SOURCE);
    $('btn-copy-console').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(GRABBER_SOURCE);
        $('import-msg').textContent = '✔ 已复制抓评脚本，切到 B 站视频页按 F12 → Console 粘贴回车即可导出 JSON。';
      } catch (_) {
        $('import-msg').textContent = '⚠ 浏览器禁止写入剪贴板，请直接把左侧黄色按钮拖到书签栏使用。';
      }
    });

    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.source !== 'ai-girl-lottery-bridge') return;
      if (ev.data.type === 'BRIDGE_READY') {
        state.bridgeReady = true;
      } else if (ev.data.type === 'FETCH_PROGRESS') {
        setStatus(ev.data.message || '正在抓取评论...');
      } else if (ev.data.type === 'FETCH_RESULT') {
        state.fetching = false;
        $('btn-go').disabled = false;
        $('btn-go-label').textContent = '开始抽奖';
        try {
          normalizeImportedPayload(ev.data.payload, false);
          if (state.drawAfterFetch) {
            state.drawAfterFetch = false;
            const n = Math.max(1, Math.min(10, parseInt($('input-draw-count').value || '1', 10) || 1));
            runDraw(n, false);
          }
        } catch (err) {
          setStatus('❌ 解析抓评结果失败：' + err.message, 'err');
        }
      } else if (ev.data.type === 'FETCH_ERROR') {
        state.fetching = false;
        state.drawAfterFetch = false;
        $('btn-go').disabled = false;
        $('btn-go-label').textContent = '开始抽奖';
        setStatus('❌ 扩展拉取失败：' + (ev.data.error || '未知错误'), 'err');
        $('connect-modal').classList.remove('hidden');
      }
    });
    window.postMessage({ source: 'ai-girl-lottery-page', type: 'PING_BRIDGE' }, '*');
  }

  function initApiSetting() {
    const params = new URLSearchParams(location.search);
    const paramApi = params.get('api');
    const saved = localStorage.getItem(API_STORAGE_KEY) || '';
    state.apiBase = (paramApi || saved || '').trim();
    if (paramApi) localStorage.setItem(API_STORAGE_KEY, state.apiBase);
    $('input-api-base').value = state.apiBase;
    $('modal-api-base').value = state.apiBase;

    const paramBv = params.get('bv') || params.get('bvid') || '';
    if (paramBv) $('input-bvid').value = paramBv;
  }

  function bindEvents() {
    $('btn-go').addEventListener('click', () => fetchAndDraw(false));
    $('input-bvid').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fetchAndDraw(false);
    });
    $('btn-refresh-comments').addEventListener('click', () => fetchAndDraw(true));

    $('btn-load-demo').addEventListener('click', () => loadDemoDataset(false));

    $('btn-toggle-sfx').addEventListener('click', () => {
      state.sfxOn = !state.sfxOn;
      $('btn-toggle-sfx').textContent = state.sfxOn ? '🔊' : '🔇';
      $('btn-toggle-sfx').setAttribute('aria-pressed', String(state.sfxOn));
    });

    $('btn-toggle-awaken').addEventListener('click', () => {
      state.awaken = !state.awaken;
      renderMcStage();
    });

    // Popover toggle & outside-click close
    $('btn-toggle-filter').addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('filter-popover');
      const hidden = pop.classList.toggle('hidden');
      $('btn-toggle-filter').setAttribute('aria-expanded', String(!hidden));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.popover-anchor')) {
        $('filter-popover').classList.add('hidden');
        $('btn-toggle-filter').setAttribute('aria-expanded', 'false');
      }
    });

    ['chk-pics-only', 'chk-dedupe', 'chk-root-only', 'sel-level', 'input-cutoff'].forEach((id) => {
      $(id).addEventListener('change', updatePoolUi);
    });
    ['input-keyword', 'input-search-pool'].forEach((id) => {
      $(id).addEventListener('input', updatePoolUi);
    });
    $('input-api-base').addEventListener('change', () => {
      state.apiBase = $('input-api-base').value.trim();
      $('modal-api-base').value = state.apiBase;
      localStorage.setItem(API_STORAGE_KEY, state.apiBase);
    });

    $('btn-save-api-go').addEventListener('click', () => {
      state.apiBase = $('modal-api-base').value.trim();
      $('input-api-base').value = state.apiBase;
      localStorage.setItem(API_STORAGE_KEY, state.apiBase);
      $('connect-modal').classList.add('hidden');
      fetchAndDraw(true);
    });

    const togglePool = (show) => {
      state.poolOpen = typeof show === 'boolean' ? show : !state.poolOpen;
      $('pool-panel').classList.toggle('hidden', !state.poolOpen);
      if (state.poolOpen) $('pool-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    $('btn-toggle-pool').addEventListener('click', () => togglePool());
    $('btn-close-pool').addEventListener('click', () => togglePool(false));
    $('btn-open-pool-pop').addEventListener('click', () => {
      $('filter-popover').classList.add('hidden');
      togglePool(true);
    });
    $('btn-open-import-pop').addEventListener('click', () => {
      $('filter-popover').classList.add('hidden');
      $('connect-modal').classList.remove('hidden');
    });

    $('btn-reset-winners').addEventListener('click', () => {
      state.voidUids.clear();
      state.wonUids.clear();
      state.winners = [];
      state.awaken = false;
      $('btn-go-label').textContent = '开始抽奖';
      renderWinners();
      updatePoolUi();
      renderMcStage('已清空本轮中奖结果，随时可以重新开始抽奖！');
    });

    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => $(el.dataset.closeModal).classList.add('hidden'));
    });

    // Global delegated click handlers for dynamic buttons inside spotlight/pool
    document.body.addEventListener('click', async (e) => {
      if (e.target.closest('#btn-empty-demo')) {
        loadDemoDataset(true);
        return;
      }
      if (e.target.closest('#btn-empty-import')) {
        $('connect-modal').classList.remove('hidden');
        return;
      }

      const zoomEl = e.target.closest('[data-zoom]');
      if (zoomEl) {
        $('lightbox-img').src = zoomEl.dataset.zoom;
        $('lightbox-cap').textContent = zoomEl.dataset.cap || '';
        $('lightbox-modal').classList.remove('hidden');
        return;
      }

      const copyBtn = e.target.closest('[data-copy-win]');
      if (copyBtn) {
        const w = state.winners[Number(copyBtn.dataset.copyWin)];
        if (!w) return;
        const txt = `🎉【40,000 粉粉丝抽奖开奖公示】恭喜 @${w.uname}（UID: ${w.uid}）中奖「Codex Pro 100（1个月）」！\n评论：「${w.content}」\n请在开奖后 7 日内 B 站私信领奖～`;
        try {
          await navigator.clipboard.writeText(txt);
          copyBtn.textContent = '✔ 已复制';
          setTimeout(() => (copyBtn.textContent = '📋 复制公示'), 1600);
        } catch (_) {
          alert(txt);
        }
        return;
      }

      const voidBtn = e.target.closest('[data-void-win]');
      if (voidBtn) {
        const idx = Number(voidBtn.dataset.voidWin);
        const w = state.winners[idx];
        if (!w) return;
        state.voidUids.add(String(w.uid));
        state.winners.splice(idx, 1);
        renderWinners();
        updatePoolUi();
        runDraw(1, true);
      }
    });

    // JSON drop / file pick
    const dz = $('drop-zone');
    const handleFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          normalizeImportedPayload(JSON.parse(String(reader.result || '')), false);
          $('import-msg').textContent = `✔ 已导入 ${state.rawComments.length} 条评论！`;
          $('connect-modal').classList.add('hidden');
        } catch (err) {
          $('import-msg').textContent = '❌ 导入失败：' + err.message;
        }
      };
      reader.readAsText(file, 'utf-8');
    };
    $('btn-pick-file').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      handleFile(e.dataTransfer.files[0]);
    });
  }

  function main() {
    initStarCanvas();
    initApiSetting();
    initMcAndRibbon();
    setupBridgeAndGrabber();
    bindEvents();
    renderMcStage();
    updatePoolUi();
  }

  main();
})();
