(function () {
  'use strict';

  const AI_GIRLS = [
    { id: 'c01', name: '鲸鱼娘', title: '星海守望' },
    { id: 'c02', name: 'Claude 娘', title: '向日葵书卷' },
    { id: 'c03', name: 'GPT 娘', title: '白龙礼服' },
    { id: 'c04', name: 'Gemini 娘', title: '星穹双子' },
    { id: 'c05', name: '小星娘', title: '炎斧骑士' },
    { id: 'c06', name: 'DeepSeek 娘', title: '青花剑姬' },
    { id: 'c07', name: 'Kimi 娘', title: '星夜琴师' },
    { id: 'c08', name: 'Qwen 娘', title: '魔方学者' },
    { id: 'c09', name: 'Seed 娘', title: '赤枪先锋' },
    { id: 'c10', name: 'MiniMax 娘', title: '金羽剑圣' },
    { id: 'c11', name: 'Mistral 娘', title: '银风游侠' },
    { id: 'c12', name: 'Grok 娘', title: '竖琴缪斯' },
  ];

  // State
  const state = {
    mcIdx: 2, // Default: c03 GPT 娘
    awaken: false,
    sfxOn: true,
    bvid: '',
    rawComments: [],
    voidUids: new Set(),
    wonUids: new Set(),
    winners: [],
    rolling: false,
    poolCollapsed: false,
    bridgeReady: false,
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  // Subtle ambient starfield
  function initStarCanvas() {
    const canvas = $('star-canvas');
    const ctx = canvas.getContext('2d');
    let stars = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 88 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.6 + 0.4,
        a: Math.random() * 0.65 + 0.25,
        s: (Math.random() - 0.5) * 0.14,
        color: Math.random() > 0.72 ? '#38f2ad' : Math.random() > 0.5 ? '#f5d27a' : '#dceaff',
      }));
    }
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        st.y -= Math.abs(st.s) + 0.04;
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

  // Soft WebAudio chime (no external MP3 needed)
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
    } catch (e) {}
  }

  // CSPRNG uniform integer [0, max)
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

  function renderMcStage(speechText) {
    const g = AI_GIRLS[state.mcIdx];
    const form = state.awaken ? 'awaken' : 'base';
    $('mc-portrait').src = `./assets/cards/${g.id}_${form}.webp`;
    $('mc-portrait').alt = `${g.name}（${state.awaken ? '觉醒形态' : '基础形态'}）`;
    $('mc-char-name').textContent = `${String(state.mcIdx + 1).padStart(2, '0')} · ${g.name}（${g.title}）`;
    $('mc-dlg-who').textContent = `${g.name} · 本期主持`;

    const badge = $('mc-form-badge');
    const frame = $('mc-frame');
    if (state.awaken) {
      badge.textContent = '★ 铁粉烫金觉醒形态';
      badge.classList.add('awakened');
      frame.classList.add('awakened');
      $('btn-toggle-awaken').textContent = '切回基础形态';
    } else {
      badge.textContent = '● 基础关注形态';
      badge.classList.remove('awakened');
      frame.classList.remove('awakened');
      $('btn-toggle-awaken').textContent = '切换觉醒形态';
    }
    frame.classList.toggle('rolling', state.rolling);

    if (speechText) $('mc-speech').textContent = speechText;

    document.querySelectorAll('.mc-chip').forEach((btn, idx) => {
      btn.classList.toggle('active', idx === state.mcIdx);
    });
  }

  function initMcAndRibbon() {
    const chips = $('mc-chips');
    const ribbon = $('ribbon-12');
    chips.innerHTML = AI_GIRLS.map(
      (g, i) => `<button class="mc-chip ${i === state.mcIdx ? 'active' : ''}" data-idx="${i}" type="button">${g.name}</button>`
    ).join('');
    ribbon.innerHTML = AI_GIRLS.map(
      (g, i) => `
        <div class="rib-card" data-idx="${i}" title="点击切换 ${g.name} 为开奖主持">
          <img src="./assets/cards/${g.id}_awaken.webp" alt="${g.name}" loading="lazy" />
          <span>${String(i + 1).padStart(2, '0')} ${g.name}</span>
        </div>`
    ).join('');

    const onSelect = (e) => {
      const el = e.target.closest('[data-idx]');
      if (!el) return;
      state.mcIdx = Number(el.dataset.idx);
      const g = AI_GIRLS[state.mcIdx];
      renderMcStage(`本小姐【${g.name}】来为你接管星穹开奖台，准备好抽出谁的票根了吗？`);
    };
    chips.addEventListener('click', onSelect);
    ribbon.addEventListener('click', onSelect);
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

  function updateStatsAndPool() {
    const rawCount = state.rawComments.length;
    const picsCount = state.rawComments.filter((c) => Array.isArray(c.pictures) && c.pictures.length > 0).length;
    const pool = getFilteredPool();
    const drawablePool = pool.filter((c) => !state.voidUids.has(String(c.uid)) && !state.wonUids.has(String(c.uid)));

    $('stat-raw').textContent = rawCount;
    $('stat-pics').textContent = picsCount;
    $('stat-eligible').textContent = drawablePool.length;
    $('stat-won').textContent = state.winners.length;
    $('pool-count').textContent = pool.length;

    const drawBtn = $('btn-draw');
    drawBtn.disabled = state.rolling || drawablePool.length === 0;
    const n = Math.max(1, Math.min(10, parseInt($('input-draw-count').value || '1', 10) || 1));
    $('btn-draw-label').textContent = state.rolling
      ? '星穹命运纺轮运转中...'
      : `启动星穹开奖（抽取 ${Math.min(n, Math.max(1, drawablePool.length))} 位）`;

    if (!state.rolling && state.winners.length === 0) {
      $('spot-heading').textContent =
        drawablePool.length > 0 ? `奖池就绪：${drawablePool.length} 位有效参与者` : '等待加载奖池……';
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
      listEl.innerHTML = `<div style="color:#98abc7;font-size:13px;padding:12px;">暂无符合当前过滤条件的评论。</div>`;
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
                <span class="cand-name">${escapeHtml(c.uname)} ${isVoid ? '（已作废）' : ''}</span>
                <span class="cand-lv">Lv${c.level || 0} · UID ${escapeHtml(c.uid)}</span>
              </div>
              <div class="cand-msg">${escapeHtml(c.content || '（纯图片评论）')}</div>
              ${picsHtml ? `<div class="cand-thumbs">${picsHtml}</div>` : ''}
            </div>
          </div>`;
      })
      .join('');
  }

  function buildCommentJumpUrl(w) {
    if (state.bvid && w.rpid) {
      return `https://www.bilibili.com/video/${encodeURIComponent(state.bvid)}/#reply${encodeURIComponent(w.rpid)}`;
    }
    return `https://space.bilibili.com/${encodeURIComponent(w.uid)}`;
  }

  function renderWinners() {
    if (state.winners.length === 0) {
      $('spotlight-body').innerHTML = `
        <div class="empty-stage">
          <div class="empty-icon">✦</div>
          <div class="empty-title">准备就绪：抽中即同屏放大显示完整评论 + AI 娘票根大图</div>
          <div class="empty-sub">支持一键加载 18 条真实感演示评论直接体验，或拖入由 B 站视频页导出的 <code>comments.json</code>。</div>
        </div>`;
      return;
    }

    $('spot-heading').textContent = `✦ 开奖公示：恭喜 ${state.winners.length} 位中奖铁粉！（同屏直显评论与晒图）`;
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
            : `<div class="win-no-pic">⚠ 该条评论未附带图片（如勾选了强制带图，可点右侧作废补抽）</div>`;

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
                <a class="btn btn-emerald" href="${escapeHtml(buildCommentJumpUrl(w))}" target="_blank" rel="noopener">🔗 直达原评论</a>
                <a class="btn btn-gold" href="https://space.bilibili.com/${escapeHtml(w.uid)}" target="_blank" rel="noopener">👤 查关注主页</a>
                <button class="btn btn-ghost" type="button" data-copy-win="${idx}">📋 复制公示文案</button>
                <button class="btn btn-danger" type="button" data-void-win="${idx}">🔄 不合条件 · 作废补抽</button>
              </div>
            </div>

            <div class="win-content-grid">
              <div class="win-comment-box">
                <div class="win-comment-label">💬 中奖者完整评论原文</div>
                <div class="win-comment-text">${escapeHtml(w.content || '（该用户仅发送了图片评论）')}</div>
              </div>
              <div class="win-pics-box">
                <div class="win-comment-label">🖼️ 评论附带票根 / 配图（点击可全屏放大）</div>
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
      renderMcStage('哎呀，当前有效奖池已经没有剩余参与者啦，检查一下过滤条件或重新导入吧。');
      return;
    }

    const targetCount = Math.min(drawCount, pool.length);
    state.rolling = true;
    state.awaken = true; // Switch AI 娘 into Awakened Golden form dramatically!
    renderMcStage(`觉醒时刻！命运星轮正在从 ${pool.length} 位带图粉丝中锁定中奖者……`);
    updateStatsAndPool();

    // Smooth decelerating visual roulette (~2.1s)
    const steps = 18;
    for (let s = 0; s < steps; s++) {
      const sample = pool[secureRandomInt(pool.length)];
      $('spot-heading').textContent = isReplacement ? '✦ 正在作废补抽第 1 位...' : '✦ 星穹命运纺轮运转中...';
      $('spotlight-body').innerHTML = `
        <div class="roulette-box">
          <img class="rl-avatar" src="${escapeHtml(sample.avatar || './assets/icons/crest_follow.webp')}" referrerpolicy="no-referrer" alt="" />
          <div>
            <div class="rl-name">${escapeHtml(sample.uname)}</div>
            <div class="rl-uid">UID ${escapeHtml(sample.uid)} · Lv.${sample.level || 0}</div>
            <div class="rl-snippet">${escapeHtml((sample.content || '（附带 AI 娘票根晒图）').slice(0, 72))}</div>
          </div>
        </div>`;
      playChime('tick');
      const delayMs = 45 + Math.round((s / steps) * (s / steps) * 185);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Actual CSPRNG selection without replacement
    const localPool = pool.slice();
    const picked = [];
    for (let k = 0; k < targetCount; k++) {
      const idx = secureRandomInt(localPool.length);
      const chosen = localPool.splice(idx, 1)[0];
      state.wonUids.add(String(chosen.uid));
      picked.push(chosen);
    }

    state.winners = isReplacement ? [...state.winners, ...picked] : [...state.winners, ...picked];
    state.rolling = false;
    playChime('win');

    const names = picked.map((p) => `【${p.uname}】`).join('、');
    renderMcStage(`恭喜 ${names} 锁定本期大奖！完整评论与票根晒图已经在右侧展开，快核验关注并公示吧～`);
    renderWinners();
    updateStatsAndPool();

    $('rng-proof').textContent = `抽签于 ${new Date().toLocaleTimeString()} · 有效池 ${pool.length} 人 · CSPRNG`;
  }

  function normalizeImportedPayload(raw) {
    let arr = [];
    let bvid = '';
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (raw && typeof raw === 'object') {
      bvid = String(raw.bvid || '');
      arr = raw.comments || raw.replies || raw.list || raw.items || [];
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('JSON 里没有找到有效评论数组（需为评论列表或 { bvid, comments }）');
    }

    const normalized = arr
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        // Support both our clean schema AND upstream bilibili API / mikuc / extension exports
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
      throw new Error('未能解析出有效评论条目（缺少 uid 字段）。');
    }
    if (bvid) {
      state.bvid = bvid;
      $('input-bvid').value = bvid;
    }
    state.rawComments = normalized;
    state.voidUids.clear();
    state.wonUids.clear();
    state.winners = [];
    state.awaken = false;
    renderWinners();
    updateStatsAndPool();
    renderMcStage(`已成功导入 ${normalized.length} 条真实评论！点击右下角按钮即可启动公平开奖。`);
  }

  function loadDemoDataset() {
    const nowSec = Math.floor(Date.now() / 1000);
    const demoNames = [
      '白龙守望者_Luo', '凌晨三点写Codex', 'Claude向日葵书童', '星穹代码猫',
      'GPT的银发发卡', '小星巨斧斩Bug', 'DeepSeek剑仙', 'Kimi夜曲不熬夜',
      'Qwen魔方炼丹师', 'Seed长枪冲锋号', 'MiniMax金羽程序员', 'Mistral风行者',
      'Grok竖琴摸鱼中', '纯文字路人甲', '只吹彩虹屁乙', '忘记传图丙',
      '双倍好运小鲸鱼', '四万粉铁粉老王'
    ];
    const demoTexts = [
      '四万粉恭喜！！在 Toy 里刚三连觉醒了白龙 GPT 娘，想拿 Codex Pro 100 帮我重构毕业设计前后端！',
      '晒我的黄金觉醒票根！每天追更 AI 娘小剧场，希望 Codex 帮我自动跑全套 Playwright 回归测试～',
      '实名羡慕这期大奖！刚点亮大肥鱼换装特辑觉醒了 Claude 娘，附带热乎票根图防吞评！',
      '分母报到！已经关注两年半了，带一张刚刚保存的高清星穹票根来接好运！',
      '为了这口黑蕾丝面具觉醒形态来的！晒出我抽到的 01-400108 编号票根，许愿 Codex Pro 100！',
      '小星娘太帅了吧！附高清觉醒卡面，希望中奖后用 Codex 写一个 B 站弹幕分析小工具。',
      '带图防吞评！青花剑姬 DeepSeek 娘质感无敌，四万粉冲向十万粉！！',
      '来接欧气啦～刚好最近疯狂需要大上下文写多 Agent 工作流，附上烫金 Kimi 娘票根！',
      'Qwen 魔方娘觉醒金边绝了！配一句正常聊天防止阿 B 吞评，祝视频直接上热门～',
      '已关注已三连！Seed 娘冲冲冲，希望把一个月 Codex Pro 100 抱回家！',
      'MiniMax 娘金羽圣剑报道！这张觉醒图必须塞进评论区，冲鸭四万粉～',
      'Mistral 精灵游侠到手，附图防吞评 + 许愿 Codex！',
      'Grok 竖琴女神来沾沾喜气，祝UP主越做越好！',
      '纯文字路过抽个奖（无配图，勾选“仅保留带图评论”会自动被过滤掉）',
      '重在参与！支持一下（无配图对照条目）',
      '来了来了（无配图对照条目）',
      '补充一张大号觉醒鲸鱼娘票根！每天都在等 AiGO 更新～',
      '老粉来打卡了！刚用手机存了高清烫金票根，希望能中一次 Codex Pro 100！'
    ];

    state.bvid = 'BV140kDemo888';
    $('input-bvid').value = 'BV140kDemo888';
    state.rawComments = demoNames.map((uname, i) => {
      const hasPic = i < 13 || i >= 16;
      const cardNum = String((i % 12) + 1).padStart(2, '0');
      const cardSrc = `./assets/cards/c${cardNum}_awaken.webp`;
      const avSrc = `./assets/cards/c${cardNum}_base.webp`;
      return {
        rpid: 900001000 + i * 7,
        uid: 40010000 + i * 137,
        uname,
        avatar: avSrc,
        level: 3 + (i % 4),
        ctime: nowSec - (20 - i) * 3600,
        date: new Date((nowSec - (20 - i) * 3600) * 1000).toLocaleString('zh-CN', { hour12: false }),
        content: demoTexts[i],
        pictures: hasPic ? [cardSrc] : [],
        isReply: false,
      };
    });
    state.voidUids.clear();
    state.wonUids.clear();
    state.winners = [];
    state.awaken = false;
    renderWinners();
    updateStatsAndPool();
    renderMcStage('已载入 18 条演示评论（其中 15 条附带 AI 娘票根晒图，3 条无图会被自动过滤）！快点「启动星穹开奖」试试效果吧～');
  }

  // Self-contained Grabber script runnable via F12 Console or Bookmarklet on any bilibili.com/video/BV... page
  const GRABBER_SOURCE = `(async()=>{try{const m=location.href.match(/(BV[0-9A-Za-z]+)/);if(!m){alert('请先在 B 站视频播放页打开（网址需含 BV 号）');return;}const bvid=m[1];const infoRes=await fetch('https://api.bilibili.com/x/web-interface/view?bvid='+bvid,{credentials:'include'}).then(r=>r.json());if(infoRes.code!==0||!infoRes.data?.aid){alert('获取视频 AID 失败：'+JSON.stringify(infoRes));return;}const aid=infoRes.data.aid;const box=document.createElement('div');box.style.cssText='position:fixed;right:20px;bottom:20px;z-index:999999;background:#09101f;color:#e8fff5;border:2px solid #f5d27a;border-radius:14px;padding:16px 20px;font-family:sans-serif;box-shadow:0 12px 36px rgba(0,0,0,0.7);min-width:290px;';box.innerHTML='<div style="font-weight:900;color:#f5d27a;margin-bottom:6px;">✦ AI 娘全量抓评器 · '+bvid+'</div><div id="ai-grab-st" style="font-size:13px;">正在抓取第 1 页评论...</div>';document.body.appendChild(box);const all=[];let next=0;let page=0;while(true){page++;const u='https://api.bilibili.com/x/v2/reply/main?csrf=&type=1&oid='+aid+'&mode=2&next='+next+'&ps=30';const res=await fetch(u,{credentials:'include'}).then(r=>r.json());if(res.code!==0){box.querySelector('#ai-grab-st').textContent='接口返回异常: '+res.code+' '+res.message;break;}const d=res.data||{};const replies=d.replies||[];for(const c of replies){const pics=(c.content?.pictures||[]).map(p=>String(p?.img_src||'').replace(/^http:\\/\\//i,'https://')).filter(Boolean);all.push({rpid:c.rpid,uid:c.member?.mid||0,uname:c.member?.uname||'',avatar:String(c.member?.avatar||'').replace(/^http:\\/\\//i,'https://'),level:c.member?.level_info?.current_level||0,ctime:c.ctime||0,date:new Date((c.ctime||0)*1000).toLocaleString('zh-CN',{hour12:false}),content:c.content?.message||'',pictures:pics,isReply:false});}box.querySelector('#ai-grab-st').textContent='已抓取第 '+page+' 页 · 累计 '+all.length+' 条（含图 '+all.filter(x=>x.pictures.length).length+' 条）';if(!d.cursor||d.cursor.is_end||replies.length===0)break;next=d.cursor.next||0;await new Promise(r=>setTimeout(r,420));}const payload={bvid,aid,exportedAt:new Date().toISOString(),comments:all};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bili_comments_'+bvid+'.json';a.click();try{await navigator.clipboard.writeText(JSON.stringify(payload));}catch(e){}box.querySelector('#ai-grab-st').innerHTML='✔ 抓取完成：共 <b>'+all.length+'</b> 条（带图 <b>'+all.filter(x=>x.pictures.length).length+'</b> 条）！JSON 已自动下载，拖进 AI 娘抽奖台即可开抽。';setTimeout(()=>box.remove(),9000);}catch(err){alert('抓取失败: '+err.message);}})();`;

  function setupGrabberAndBridge() {
    $('bookmarklet-link').href = 'javascript:' + encodeURIComponent(GRABBER_SOURCE);
    $('btn-copy-console').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(GRABBER_SOURCE);
        $('import-msg').textContent = '✔ 抓评脚本已复制到剪贴板！请切到 B 站视频页按 F12 → Console 粘贴回车即可自动下载 JSON。';
      } catch (e) {
        $('paste-json').value = GRABBER_SOURCE;
        $('import-msg').textContent = '请全选下方脚本复制到 B 站视频页 F12 控制台运行。';
      }
    });

    // Listen for optional Chrome/Edge Bridge extension
    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.source !== 'ai-girl-lottery-bridge') return;
      if (ev.data.type === 'BRIDGE_READY') {
        state.bridgeReady = true;
        $('bridge-status').textContent = '✔ 已检测到本地桥接扩展！填好 BV 号点「⚡ 桥接直拉」即可一键拉取全部评论与附图。';
        $('bridge-status').style.color = '#38f2ad';
      } else if (ev.data.type === 'FETCH_PROGRESS') {
        $('bridge-status').textContent = ev.data.message || '正在拉取评论...';
      } else if (ev.data.type === 'FETCH_RESULT') {
        try {
          normalizeImportedPayload(ev.data.payload);
          $('bridge-status').textContent = `✔ 桥接拉取完成：共导入 ${state.rawComments.length} 条评论。`;
        } catch (err) {
          $('bridge-status').textContent = '❌ 解析拉取结果失败: ' + err.message;
        }
      } else if (ev.data.type === 'FETCH_ERROR') {
        $('bridge-status').textContent = '❌ 拉取失败: ' + (ev.data.error || '未知错误');
      }
    });
    window.postMessage({ source: 'ai-girl-lottery-page', type: 'PING_BRIDGE' }, '*');

    $('btn-bridge-fetch').addEventListener('click', () => {
      const raw = $('input-bvid').value.trim();
      const m = raw.match(/(BV[0-9A-Za-z]+)/);
      if (!m) {
        $('bridge-status').textContent = '⚠ 请先输入合法的 BV 号或 B 站视频链接（如 BV1jb421p7zC）。';
        return;
      }
      if (!state.bridgeReady) {
        $('bridge-status').textContent = 'ℹ 尚未检测到本地桥接扩展，为你打开免装抓评导入窗（支持书签/Console 一键抓评，同样 0 服务器不泄 Cookie）。';
        $('import-modal').classList.remove('hidden');
        return;
      }
      $('bridge-status').textContent = `正在通过本地扩展直连 B 站拉取 ${m[1]} 评论...`;
      window.postMessage({ source: 'ai-girl-lottery-page', type: 'FETCH_COMMENTS', bvid: m[1] }, '*');
    });
  }

  function bindEvents() {
    $('btn-load-demo').addEventListener('click', loadDemoDataset);
    $('btn-open-import').addEventListener('click', () => $('import-modal').classList.remove('hidden'));
    $('btn-open-import-inline').addEventListener('click', () => $('import-modal').classList.remove('hidden'));

    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => $(el.dataset.closeModal).classList.add('hidden'));
    });

    $('btn-toggle-awaken').addEventListener('click', () => {
      state.awaken = !state.awaken;
      renderMcStage();
    });

    $('btn-toggle-sfx').addEventListener('click', () => {
      state.sfxOn = !state.sfxOn;
      $('btn-toggle-sfx').textContent = state.sfxOn ? '🔊 音效：开' : '🔇 音效：关';
      $('btn-toggle-sfx').setAttribute('aria-pressed', String(state.sfxOn));
    });

    ['chk-pics-only', 'chk-dedupe', 'chk-root-only', 'sel-level', 'input-cutoff'].forEach((id) => {
      $(id).addEventListener('change', updateStatsAndPool);
    });
    ['input-keyword', 'input-draw-count', 'input-search-pool'].forEach((id) => {
      $(id).addEventListener('input', updateStatsAndPool);
    });

    $('btn-toggle-pool').addEventListener('click', () => {
      state.poolCollapsed = !state.poolCollapsed;
      $('pool-list').classList.toggle('collapsed', state.poolCollapsed);
    });

    $('btn-draw').addEventListener('click', () => {
      if (state.rolling) return;
      const n = Math.max(1, Math.min(10, parseInt($('input-draw-count').value || '1', 10) || 1));
      runDraw(n, false);
    });

    $('btn-redraw-reset').addEventListener('click', () => {
      state.voidUids.clear();
      state.wonUids.clear();
      state.winners = [];
      state.awaken = false;
      renderWinners();
      updateStatsAndPool();
      renderMcStage('已清空本轮中奖记录，AI 娘随时准备重新开启命运纺轮！');
    });

    // Winner card delegation (zoom, copy announcement, void & redraw 1 replacement)
    document.body.addEventListener('click', async (e) => {
      const zoomEl = e.target.closest('[data-zoom]');
      if (zoomEl) {
        $('lightbox-img').src = zoomEl.dataset.zoom;
        $('lightbox-cap').textContent = zoomEl.dataset.cap || '';
        $('lightbox-modal').classList.remove('hidden');
        return;
      }

      const copyBtn = e.target.closest('[data-copy-win]');
      if (copyBtn) {
        const idx = Number(copyBtn.dataset.copyWin);
        const w = state.winners[idx];
        if (!w) return;
        const txt = `🎉【40,000 粉粉丝抽奖开奖公示】恭喜 @${w.uname}（UID: ${w.uid}）中奖「Codex Pro 100（1个月）」！\n评论内容：「${w.content}」\n请在开奖后 7 日内 B 站私信联系领奖～`;
        try {
          await navigator.clipboard.writeText(txt);
          copyBtn.textContent = '✔ 已复制公示文案';
          setTimeout(() => (copyBtn.textContent = '📋 复制公示文案'), 1800);
        } catch (err) {
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
        updateStatsAndPool();
        runDraw(1, true);
      }
    });

    // File drag/drop & paste JSON
    const dz = $('drop-zone');
    const handleFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          normalizeImportedPayload(JSON.parse(String(reader.result || '')));
          $('import-msg').textContent = `✔ 已导入 ${state.rawComments.length} 条真实评论！`;
          $('import-modal').classList.add('hidden');
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

    $('btn-parse-paste').addEventListener('click', () => {
      try {
        normalizeImportedPayload(JSON.parse($('paste-json').value.trim()));
        $('import-msg').textContent = `✔ 已导入 ${state.rawComments.length} 条评论！`;
        $('import-modal').classList.add('hidden');
      } catch (err) {
        $('import-msg').textContent = '❌ 解析失败：' + err.message;
      }
    });
  }

  function main() {
    initStarCanvas();
    initMcAndRibbon();
    setupGrabberAndBridge();
    bindEvents();
    renderMcStage();
    updateStatsAndPool();
  }

  main();
})();
