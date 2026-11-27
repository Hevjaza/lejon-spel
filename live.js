'use strict';
/* ---------------- 🔴 Live + matchfakta (v8) ----------------
   Källa: ESPN:s publika JSON (CORS öppet, ingen nyckel). Svenska Spels API går inte att
   anropa direkt från webbläsaren (saknar CORS), så deras status kommer via data.json. */
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
const LIGA = {
  'Premier League|England': 'soccer/eng.1', 'Championship|England': 'soccer/eng.2', 'League One|England': 'soccer/eng.3', 'League Two|England': 'soccer/eng.4',
  'La Liga|Spanien': 'soccer/esp.1', 'La Liga 2|Spanien': 'soccer/esp.2', 'Serie A|Italien': 'soccer/ita.1', 'Serie B|Italien': 'soccer/ita.2',
  'Bundesliga|Tyskland': 'soccer/ger.1', '2. Bundesliga|Tyskland': 'soccer/ger.2', 'Ligue 1|Frankrike': 'soccer/fra.1', 'Ligue 2|Frankrike': 'soccer/fra.2',
  'Eredivisie|Nederländerna': 'soccer/ned.1', 'Primeira Liga|Portugal': 'soccer/por.1', 'Pro League|Belgien': 'soccer/bel.1', 'Superligan|Danmark': 'soccer/den.1',
  'Allsvenskan|Sverige': 'soccer/swe.1', 'Superettan|Sverige': 'soccer/swe.2', 'Eliteserien|Norge': 'soccer/nor.1', 'Super Lig|Turkiet': 'soccer/tur.1',
  'Super League 1|Grekland': 'soccer/gre.1', 'Premiership|Skottland': 'soccer/sco.1', 'Super League|Schweiz': 'soccer/sui.1', 'Bundesliga|Österrike': 'soccer/aut.1',
  'MLS|USA': 'soccer/usa.1', 'Liga MX, Apertura|Mexiko': 'soccer/mex.1', 'Liga MX, Clausura|Mexiko': 'soccer/mex.1', 'Brasileiro Serie A|Brasilien': 'soccer/bra.1',
  'J.League|Japan': 'soccer/jpn.1', 'Primera Division|Chile': 'soccer/chi.1', 'Primera A, Apertura|Colombia': 'soccer/col.1', 'Primera A, Clausura|Colombia': 'soccer/col.1',
  'Copa Libertadores': 'soccer/conmebol.libertadores', 'Champions League': 'soccer/uefa.champions', 'Europa League': 'soccer/uefa.europa',
  'Conference League': 'soccer/uefa.europa.conf', 'VM-kval, Europa': 'soccer/fifa.worldq.uefa', 'NHL|USA': 'hockey/nhl', 'NHL': 'hockey/nhl'
};
const STORA = { 'soccer/eng.1': 'Premier League', 'soccer/esp.1': 'La Liga', 'soccer/ita.1': 'Serie A', 'soccer/ger.1': 'Bundesliga', 'soccer/fra.1': 'Ligue 1',
  'soccer/swe.1': 'Allsvenskan', 'soccer/uefa.champions': 'Champions League', 'soccer/uefa.europa': 'Europa League', 'hockey/nhl': 'NHL 🏒' };
const ligaSlug = m => m ? (LIGA[(m.liga || '') + '|' + (m.land || '')] || LIGA[m.liga || ''] || null) : null;
const LV = { t: null, busy: false, last: null, fel: false, tick: 0, ev: {}, match: {}, sum: {}, prev: {}, flash: {}, open: new Set(), facts: {}, day: {} };
const fmtT = iso => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const fmtS = d => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, ''); // ESPN räknar datum i USA-östtid
const mkey = m => (m.matchId || (m.hemma + '-' + m.borta)) + '|' + m.start;
async function fj(url, ms) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 10000);
  try { const r = await fetch(url, { signal: c.signal, cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}

/* --- lagnamn: Svenska Spel ↔ ESPN --- */
const GEN = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'sv', 'fk', 'if', 'bk', 'ik', 'ff', 'sk', 'cd', 'ud', 'rc', 'club', 'de', 'la', 'the', 'town', 'city', 'united', 'utd', 'real', 'sporting', 'athletic', 'calcio', 'hockey', 'county', 'rovers', 'wanderers', 'albion']);
const toks = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3);
function sim(a, names) {
  let best = 0; const A = toks(a);
  for (const n of names) for (const y of toks(n)) for (const x of A) {
    const g = GEN.has(x) || GEN.has(y);
    if (x === y) best = Math.max(best, g ? 0.5 : 2);
    else if (!g && x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4)) best = Math.max(best, 1);
  }
  return best;
}
function findEv(m) {
  if (m && m._x) return m._x;
  const sl = ligaSlug(m); if (!sl || m.duell) return null;
  const k = mkey(m); if (LV.match[k] && LV.ev[LV.match[k]]) return LV.ev[LV.match[k]];
  const st = +new Date(m.start); let best = null;
  for (const x of Object.values(LV.ev)) {
    if (x.slug !== sl) continue;
    const dt = Math.abs(+new Date(x.start) - st); if (dt > 3 * 36e5) continue;
    const s = sim(m.hemma, x.hn) + sim(m.borta, x.an);
    if (s >= 2 && (!best || s > best.s || (s === best.s && dt < best.dt))) best = { s, dt, x };
  }
  if (best) { LV.match[k] = best.x.key; return best.x; }
  return null;
}

/* --- ESPN-händelse → enkelt objekt --- */
function parseEv(e, slug) {
  const c = e.competitions && e.competitions[0]; if (!c || !c.competitors) return null;
  const H = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0], A = c.competitors.find(x => x.homeAway === 'away') || c.competitors[1];
  const st = e.status || c.status || {}, ty = st.type || {}, hockey = slug.startsWith('hockey');
  let ord = null, per = null;
  if (hockey && H.linescores && A.linescores) {
    const s = x => x.linescores.filter(l => (l.period || 0) <= 3).reduce((a, l) => a + (+l.value || 0), 0);
    ord = [s(H), s(A)]; per = H.linescores.map((l, i) => [+l.value || 0, +((A.linescores[i] || {}).value) || 0]);
  }
  const det = (c.details || []).map(d => ({ typ: d.redCard ? 'red' : d.yellowCard ? 'yellow' : d.scoringPlay ? 'goal' : '', min: (d.clock && d.clock.displayValue) || '',
    sida: d.team && d.team.id === H.team.id ? 0 : 1, vem: ((d.athletesInvolved || [])[0] || {}).displayName || '', own: !!d.ownGoal, pen: !!d.penaltyKick })).filter(d => d.typ);
  const names = t => [t.team.displayName, t.team.shortDisplayName, t.team.name, t.team.location].filter(Boolean);
  return { key: slug + ':' + e.id, id: e.id, slug, hockey, start: e.date, state: ty.state, sname: ty.name || '', period: st.period || 0, clock: st.displayClock || '',
    short: ty.shortDetail || '', home: H.team.shortDisplayName || H.team.displayName, away: A.team.shortDisplayName || A.team.displayName,
    hn: names(H), an: names(A), hid: H.team.id, aid: A.team.id, sc: [+H.score || 0, +A.score || 0], ord, per, det, venue: (e.venue || c.venue || {}).fullName || (e.venue || c.venue || {}).displayName };
}
function lvStatus(x) {
  if (x.state === 'pre') return /POSTPONED|CANCEL/.test(x.sname) ? { txt: 'Inställd', cls: 'post' } : { txt: fmtT(x.start), cls: 'pre' };
  if (x.state === 'post') return /POSTPONED|CANCEL|ABANDON/.test(x.sname) ? { txt: 'Inställd', cls: 'post' } : { txt: x.hockey && x.period === 4 ? 'Slut förl.' : x.hockey && x.period >= 5 ? 'Slut str.' : 'Slut', cls: 'post' };
  if (/HALFTIME/.test(x.sname)) return { txt: 'HT', cls: 'live ht' };
  if (x.hockey) {
    if (/END_PERIOD|INTERMISSION/.test(x.sname) || /^End/i.test(x.short)) return { txt: 'Paus', cls: 'live ht' };
    if (x.period === 4) return { txt: 'Förl ' + x.clock, cls: 'live' };
    if (x.period >= 5) return { txt: 'Straffar', cls: 'live' };
    return { txt: `P${x.period} ${x.clock}`, cls: 'live' };
  }
  return { txt: x.clock && x.clock !== "0'" ? x.clock : 'Live', cls: 'live' };
}
const tecken = sc => sc[0] > sc[1] ? 0 : sc[0] === sc[1] ? 1 : 2;
function liveOf(m) {
  const x = findEv(m);
  if (x) {
    const started = x.state !== 'pre', sc = started ? x.sc : null;
    return { x, src: 'espn', st: lvStatus(x), sc, t: started && !/CANCEL|POSTPONED/.test(x.sname) ? tecken(x.hockey && x.ord ? x.ord : x.sc) : null, started, live: x.state === 'in', done: x.state === 'post' };
  }
  const l = m.lage || 'NotStarted', past = new Date(m.start) < Date.now();
  if (l === 'NotStarted') return past ? { src: 'ss', st: { txt: 'Ingen live', cls: 'unk' }, sc: null, t: null, unknown: true } : { src: 'ss', st: { txt: fmtT(m.start), cls: 'pre' }, sc: null, t: null };
  const ended = /End|Clos|Finish|Final/i.test(l), sc = m.resultat || null;
  return { src: 'ss', st: { txt: ended ? 'Slut' : 'Pågår*', cls: ended ? 'post' : 'unk' }, sc, t: sc && ended ? tecken(m.ordinarie || sc) : null, started: true, done: ended, unknown: !ended };
}

/* --- vilka kuponger följs live --- */
function liveCoupons() {
  const G = games(), out = [], now = Date.now();
  const sen = ((S.data && S.data.live) || {}).senaste || {};
  for (const k of FOOT) {
    const list = [...(sen[k] || []), G[k]].filter(g => g && g.matcher && g.omgang);
    for (const g of list) {
      const ts = g.matcher.map(m => +new Date(m.start));
      if (Math.max(...ts) < now - 12 * 36e5 || Math.min(...ts) > now + 30 * 36e5) continue;
      out.push({ k, g, id: k + ':' + g.omgang });
    }
  }
  const rank = c => { const L = c.g.matcher.filter(m => !m.struken).map(liveOf); if (L.some(l => l.live)) return 0; if (L.every(l => l.done)) return 2; return 1; };
  const first = c => Math.min(...c.g.matcher.map(m => +new Date(m.start)));
  return out.map(c => Object.assign(c, { r: rank(c) })).sort((a, b) => a.r - b.r || (a.r === 2 ? first(b) - first(a) : first(a) - first(b)));
}

/* --- hämtning var 20:e sekund --- */
async function liveTick(manual) {
  if (LV.busy || !S.data) return; LV.busy = true; LV.tick++;
  try {
    const urls = new Map(), now = Date.now();
    for (const c of liveCoupons()) for (const m of c.g.matcher) {
      const sl = ligaSlug(m); if (!sl || m.duell || m.struken) continue;
      const st = +new Date(m.start); if (st > now + 20 * 6e4 || st < now - 14 * 36e5) continue;
      const dk = sl + '|' + ymd(new Date(st));
      if (LV.day[dk] && LV.day[dk].done && !manual) continue; // färdigspelad dag – hämta inte igen
      urls.set(`${ESPN}${sl}/scoreboard?dates=${ymd(new Date(st))}`, [sl, dk]);
    }
    if (manual || LV.tick % 3 === 1) Object.keys(STORA).forEach(sl => urls.set(`${ESPN}${sl}/scoreboard`, [sl, null]));
    const res = await Promise.allSettled([...urls].map(([u, v]) => fj(u).then(d => [v, d])));
    let ok = 0;
    res.forEach(r => {
      if (r.status !== 'fulfilled') return; ok++;
      const [[sl, dk], d] = r.value; const xs = (d.events || []).map(e => parseEv(e, sl)).filter(Boolean);
      xs.forEach(x => { LV.ev[x.key] = x; });
      if (dk) LV.day[dk] = { done: xs.length > 0 && xs.every(x => x.state === 'post') };
    });
    detectGoals();
    const open = [...LV.open].map(k => LV.ev[k]).filter(x => x && (x.state === 'in' || !LV.sum[x.key]));
    await Promise.allSettled(open.map(x => loadSum(x)));
    LV.fel = urls.size > 0 && ok === 0; LV.last = new Date();
  } finally {
    LV.busy = false;
    if (S.view === 'live') renderKeep();
  }
}
function detectGoals() {
  const mine = new Set(); liveCoupons().forEach(c => c.g.matcher.forEach(m => { const x = findEv(m); if (x) mine.add(x.key); }));
  for (const x of Object.values(LV.ev)) {
    const tot = x.sc[0] + x.sc[1], p = LV.prev[x.key];
    if (p != null && tot > p && x.state !== 'pre') {
      LV.flash[x.key] = Date.now();
      if (mine.has(x.key) && S.view === 'live') {
        const g = [...x.det].reverse().find(d => d.typ === 'goal');
        toast(`${x.hockey ? '🏒' : '⚽'} MÅL! ${x.home} ${x.sc[0]}–${x.sc[1]} ${x.away}${g && g.vem ? ' · ' + g.vem : ''}`);
        try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { }
      }
    }
    LV.prev[x.key] = tot;
  }
}
async function loadSum(x) {
  const s = LV.sum[x.key]; if (s && Date.now() - s.t < 15000) return;
  const d = await fj(`${ESPN}${x.slug}/summary?event=${x.id}`);
  LV.sum[x.key] = { t: Date.now(), d };
}
function liveSched() {
  clearInterval(LV.t); LV.t = null;
  if (S.view === 'live' && document.visibilityState === 'visible' && S.data) { liveTick(); LV.t = setInterval(liveTick, 20000); }
}
function renderKeep() { const y = window.scrollY; render(); window.scrollTo(0, y); }

/* --- händelseflöde (svenska) --- */
function feed(x) {
  const s = LV.sum[x.key] && LV.sum[x.key].d, out = [];
  const lag = id => id === x.hid ? x.home : id === x.aid ? x.away : '';
  if (s && !x.hockey && s.keyEvents) {
    for (const k of s.keyEvents) {
      const ty = (k.type && k.type.type) || '', min = (k.clock && k.clock.displayValue) || '', p = (k.participants || []).map(q => q.athlete && q.athlete.displayName), tm = k.team ? lag(k.team.id) || k.team.displayName : '';
      if (k.scoringPlay || /goal|penalty---scored/.test(ty)) out.push([min, '⚽', `<b>Mål</b> ${esc(p[0] || '')}${/own/.test(ty) ? ' (självmål)' : /penalty/.test(ty) ? ' (straff)' : ''} · ${esc(tm)}`, 'g']);
      else if (/red-card/.test(ty)) out.push([min, '🟥', `Rött kort ${esc(p[0] || '')} · ${esc(tm)}`]);
      else if (/yellow-card/.test(ty)) out.push([min, '🟨', `Gult kort ${esc(p[0] || '')} · ${esc(tm)}`]);
      else if (/substitution/.test(ty)) out.push([min, '🔄', `Byte ${esc(tm)}: in ${esc(p[0] || '?')}, ut ${esc(p[1] || '?')}`]);
      else if (/halftime/.test(ty)) out.push([min, '⏸', 'Halvtid']);
      else if (ty === 'kickoff') out.push(['', '▶️', 'Avspark']);
      else if (/end-regular-time|full-time/.test(ty)) out.push([min, '🏁', 'Slut']);
    }
  } else if (s && x.hockey && s.plays) {
    for (const p of s.plays) {
      if (!p.scoringPlay) continue;
      const who = ((p.participants || []).find(q => q.type === 'scorer') || {}).athlete;
      out.push([`P${(p.period || {}).number || ''} ${(p.clock || {}).displayValue || ''}`, '🏒', `<b>Mål</b> ${esc(who ? who.displayName : '')} · ${esc(lag((p.team || {}).id))} (${p.homeScore}–${p.awayScore})`, 'g']);
    }
  } else {
    x.det.forEach(d => out.push([d.min, d.typ === 'goal' ? '⚽' : d.typ === 'red' ? '🟥' : '🟨', `${d.typ === 'goal' ? '<b>Mål</b> ' : d.typ === 'red' ? 'Rött kort ' : 'Gult kort '}${esc(d.vem)}${d.own ? ' (självmål)' : d.pen ? ' (straff)' : ''} · ${esc(d.sida ? x.away : x.home)}`, d.typ === 'goal' ? 'g' : '']));
  }
  const per = x.hockey && x.per ? `<div class="muted small" style="margin:4px 0 6px">Perioder: ${x.per.map(p => p.join('–')).join(', ')}${x.ord && x.period >= 4 ? ` · 1X2 räknas på ordinarie tid ${x.ord.join('–')}` : ''}</div>` : '';
  const rows = out.slice().reverse().map(([m, i, t, c]) => `<div class="fe ${c || ''}"><span class="fm">${esc(m)}</span><span>${i}</span><span>${t}</span></div>`).join('');
  return per + (rows || `<div class="muted small">${x.state === 'pre' ? 'Matchen har inte startat.' : s ? 'Inga händelser än.' : 'Hämtar händelser…'}</div>`) +
    `<div class="muted small" style="margin-top:6px">Källa: ESPN${x.hockey ? '' : ' (mål, kort och byten)'}</div>`;
}

/* --- vy --- */
function lrow(m, picks, own) {
  const L = liveOf(m), id = L.x ? L.x.key : null;
  const flash = id && LV.flash[id] && Date.now() - LV.flash[id] < 15000;
  const mine = (picks && picks.length ? (L.t == null ? 'tk' : picks.includes(L.t) ? 'tk ok' : 'tk bad') : 'tk') + (L.t == null && !(picks && picks.length) ? ' empty' : '');
  const pickTxt = picks && picks.length ? picks.slice().sort().map(t => '1X2'[t]).join('') : '';
  const sc = L.sc ? `<span class="lsc"><b>${L.sc[0]}</b><b>${L.sc[1]}</b></span>` : '<span class="lsc"><b>–</b><b>–</b></span>';
  const head = `<span class="lst ${L.st.cls}">${L.st.cls.startsWith('live') ? '<i class="pulse"></i>' : ''}${esc(L.st.txt)}</span>
    <span class="lteams"><b>${m.nr ? m.nr + '. ' : ''}${esc(m.hemma)}</b><b>${esc(m.borta)}</b></span>${sc}
    <span class="${mine}">${L.t == null ? '' : '1X2'[L.t]}${pickTxt ? `<small>${pickTxt}</small>` : ''}</span>`;
  if (!id) return `<div class="lrow ${L.st.cls.split(' ')[0]}"><div class="lsum">${head}</div></div>`;
  return `<details class="lrow ${L.st.cls.split(' ')[0]} ${flash ? 'goal' : ''}" data-lk="${esc(id)}" ${LV.open.has(id) ? 'open' : ''}><summary class="lsum">${head}</summary><div class="lfeed">${feed(L.x)}</div></details>`;
}
function myCoupon(c) {
  const s = S.sel[c.id]; if (!s || !s.some(x => x.length)) return '';
  let ratt = 0, start = 0, ej = 0; const emot = [];
  c.g.matcher.forEach((m, i) => {
    const L = liveOf(m), p = s[i] || [];
    if (L.t == null) { ej++; return; }
    start++; if (p.includes(L.t)) ratt++; else emot.push({ m, L, p });
  });
  const n = c.g.matcher.length;
  return `<div class="card kup"><div class="row"><b>🎫 Din kupong · ${esc(SPORTNAMN[c.k])}</b><span class="chip">omg ${esc(c.g.omgang)}</span></div>
    <div class="kbig">Just nu: <span class="win">${ratt} rätt</span></div>
    <div class="muted small">${start ? `${start} av ${n} matcher har resultat` : 'Inga matcher har startat än'}${ej && start ? ` · ${ej} ej startade/okända` : ''} · räknat på din bästa rad</div>
    ${emot.length ? `<div class="emot"><div class="small" style="font-weight:800;color:var(--red);margin-top:8px">Emot dig just nu</div>${emot.map(({ m, L, p }) => `<div class="small">${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)} <b>${L.sc ? L.sc.join('–') : ''}</b> · ${'1X2'[L.t]} just nu, du har ${p.length ? p.slice().sort().map(t => '1X2'[t]).join('') : 'inget'}</div>`).join('')}</div>` : start ? '<div class="small win" style="margin-top:6px">Allt går din väg just nu 👍</div>' : ''}</div>`;
}
function vLive() {
  const cs = liveCoupons();
  const seg = `<div class="seg">${[['alla', 'Alla'], ...FOOT.map(k => [k, KORT[k]])].map(([k, t]) => `<button data-lg="${k}" class="${(S.lg || 'alla') === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const vis = cs.filter(c => (S.lg || 'alla') === 'alla' || c.k === S.lg);
  const up = LV.last ? `Uppdaterad ${fmtS(LV.last)}` : 'Hämtar live…';
  const mineCards = vis.map(myCoupon).join('');
  const sections = vis.map(c => {
    const ms = c.g.matcher.filter(m => !m.struken);
    const nl = ms.filter(m => liveOf(m).live).length;
    const utan = [...new Set(ms.filter(m => !m.duell && (!ligaSlug(m) || (new Date(m.start) < Date.now() - 5 * 6e4 && !findEv(m)))).map(m => m.liga || 'okänd liga'))];
    const note = utan.length ? `<div class="muted small lnote">${esc(utan.join(', '))}: ingen fri live-källa – ${ms.some(m => !findEv(m) && liveOf(m).done) ? 'resultat från Svenska Spel' : 'status från Svenska Spel'} vid senaste uppdatering (${esc(fmt(S.data.uppdaterad, { weekday: undefined, day: undefined, month: undefined }))}).</div>` : '';
    return `<div class="bhead"><b>${esc(SPORTNAMN[c.k])} · omg ${esc(c.g.omgang)}</b>${nl ? `<span class="chip lvchip"><i class="pulse"></i>${nl} live</span>` : `<span class="chip">${esc(fmt(c.g.matcher[0].start, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: undefined, month: undefined }))}</span>`}</div>
      <div class="card lcard">${c.g.matcher.map((m, i) => lrow(m, (S.sel[c.id] || [])[i])).join('')}${note}</div>`;
  }).join('');
  const linked = new Set(); cs.forEach(c => c.g.matcher.forEach(m => { const x = findEv(m); if (x) linked.add(x.key); }));
  const others = Object.values(LV.ev).filter(x => STORA[x.slug] && x.state === 'in' && !linked.has(x.key));
  const byL = {}; others.forEach(x => (byL[x.slug] = byL[x.slug] || []).push(x));
  const alla = Object.keys(byL).length ? Object.entries(byL).map(([sl, xs]) => `<div class="muted small" style="margin:8px 2px 2px;font-weight:700">${esc(STORA[sl])}</div>` + xs.map(x => lrow({ hemma: x.home, borta: x.away, start: x.start, liga: STORA[x.slug], _x: x })).join('')).join('') : '';
  const anyLive = cs.some(c => c.g.matcher.some(m => liveOf(m).live)) || others.length;
  const next = cs.flatMap(c => c.g.matcher.filter(m => !m.struken && new Date(m.start) > Date.now()).map(m => ({ m, k: c.k }))).sort((a, b) => new Date(a.m.start) - new Date(b.m.start)).slice(0, 5);
  const empty = !anyLive ? `<div class="card"><h3>Inga live-matcher just nu</h3><div class="muted small">Nästa avspark på kupongerna:</div><div class="list">${next.map(({ m, k }) => `<div class="li"><span>${esc(m.hemma)} – ${esc(m.borta)}<br><span class="muted small">${esc(KORT[k])} · ${esc(m.liga || '')}</span></span><span class="chip">${esc(fmt(m.start))}</span></div>`).join('') || '<div class="none">Inga kommande matcher inlagda.</div>'}</div></div>` : '';
  return `<h2>🔴 Live</h2><div class="lvbar"><span class="muted small">${esc(up)} · uppdateras var 20:e s${LV.fel ? ' · <span style="color:var(--red)">kunde inte hämta – försöker igen</span>' : ''}</span><button class="lvref" data-lr="1" aria-label="Uppdatera live">↻</button></div>
    ${seg}${empty}${mineCards}${sections || '<div class="warn">Ingen kupong med matcher i dag eller i morgon.</div>'}
    ${(S.lg || 'alla') === 'alla' ? `<div class="bhead"><b>Alla live-matcher</b><span class="chip">stora ligor</span></div><div class="card lcard">${alla || '<div class="muted small" style="padding:6px 2px">Inga andra live-matcher i de stora ligorna just nu.</div>'}</div>` : ''}
    <details class="card"><summary>Om live-datan</summary><div class="muted small">Ställning, minut, mål, kort och byten kommer från ESPN:s öppna data (ca 10–30 s fördröjning, uppdateras här var 20:e sekund när fliken är öppen). SHL, HockeyAllsvenskan, AHL och några mindre ligor finns inte där – då visas Svenska Spels status från senaste uppdatering. Powerplay räknar 1X2 på ordinarie tid (60 min). Tryck på en match för händelser.</div></details>`;
}

/* --- matchfakta för Sport-fliken (form, tabell, inbördes, arena) --- */
async function loadFacts(m) {
  const k = mkey(m); if (LV.facts[k]) return;
  const sl = ligaSlug(m);
  if (!sl) { LV.facts[k] = { none: true }; return; }
  LV.facts[k] = { loading: true };
  try {
    let x = findEv(m);
    if (!x) {
      const d = await fj(`${ESPN}${sl}/scoreboard?dates=${ymd(new Date(m.start))}`);
      (d.events || []).map(e => parseEv(e, sl)).filter(Boolean).forEach(e => { LV.ev[e.key] = LV.ev[e.key] || e; });
      x = findEv(m);
    }
    if (!x) { LV.facts[k] = { none: true }; return; }
    const s = await fj(`${ESPN}${sl}/summary?event=${x.id}`);
    LV.facts[k] = { x, s };
  } catch { LV.facts[k] = { fel: true }; }
}
function factsHtml(m) {
  const f = LV.facts[mkey(m)];
  if (!f || f.loading) return '<div class="muted small">Hämtar matchfakta…</div>';
  if (f.fel) return '<div class="muted small">Kunde inte hämta matchfakta just nu.</div>';
  if (f.none) return `<div class="muted small">Matchfakta (form, tabell, inbördes): Saknas för ${esc(m.liga || 'den här ligan')} i vår fria källa.</div>`;
  const { x, s } = f, rows = [];
  const venue = (s.gameInfo && s.gameInfo.venue && s.gameInfo.venue.fullName) || x.venue;
  rows.push(['Avspark', fmt(m.start) + (venue ? ' · ' + venue : '')]);
  const formOf = id => { const t = (s.lastFiveGames || []).find(q => q.team && q.team.id === id); return t ? t.events.map(e => ({ W: 'V', D: 'O', L: 'F' }[e.gameResult] || '?')) : null; };
  const fH = formOf(x.hid), fA = formOf(x.aid);
  const chips = f => f.map(r => `<i class="fr f${r}">${r}</i>`).join('');
  if (fH || fA) rows.push(['Form (senaste 5, nyast sist)', `<div>${esc(m.hemma)} ${fH ? chips(fH) : 'Saknas'}</div><div>${esc(m.borta)} ${fA ? chips(fA) : 'Saknas'}</div>`, true]);
  const tab = id => { for (const g of ((s.standings || {}).groups || [])) { const es = (g.standings || {}).entries || []; const i = es.findIndex(e => e.id === id); if (i >= 0) { const st = Object.fromEntries(es[i].stats.map(q => [q.name, q.displayValue])); return [`${st.rank || i + 1}:a`, st.points != null ? `${st.points} p` : '', st.gamesPlayed != null ? `${st.gamesPlayed} m` : ''].filter(Boolean).join(' · '); } } return null; };
  const tH = tab(x.hid), tA = tab(x.aid);
  if (tH || tA) rows.push(['Tabell', `<div>${esc(m.hemma)}: ${esc(tH || 'Saknas')}</div><div>${esc(m.borta)}: ${esc(tA || 'Saknas')}</div>`, true]);
  const ser = (s.seasonseries || []).find(q => q.type === 'head-to-head') || (s.seasonseries || [])[0];
  const h2h = ser && (ser.events || []).filter(e => e.statusType ? e.statusType.completed : e.status === 'post').sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  rows.push(['Inbördes möten (senaste först)', h2h && h2h.length ? h2h.map(e => { const H = e.competitors.find(c => c.homeAway === 'home'), A = e.competitors.find(c => c.homeAway === 'away'); return `<div>${esc(new Date(e.date).toLocaleDateString('sv-SE', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(H.team.displayName)} ${esc(H.score)}–${esc(A.score)} ${esc(A.team.displayName)}</div>`; }).join('') : 'Saknas', true]);
  const inj = (s.injuries || []).map(t => { const l = (t.injuries || []).slice(0, 4).map(i => `${i.athlete && i.athlete.displayName} (${i.status || 'skadad'})`); return l.length ? `<div>${esc(t.team && t.team.id === x.hid ? m.hemma : m.borta)}: ${esc(l.join(', '))}</div>` : ''; }).join('');
  rows.push(['Skador/avstängningar', inj || 'Saknas i fri källa', true]);
  return `<div class="facts">${rows.map(([k, v, raw]) => `<div class="fr2"><span>${k}</span><div>${raw ? v : esc(v)}</div></div>`).join('')}</div><div class="muted small" style="margin-top:4px">Källa: ESPN</div>`;
}
document.addEventListener('toggle', e => {
  const d = e.target; if (!d || d.tagName !== 'DETAILS') return;
  if (d.dataset.lk) { const k = d.dataset.lk; if (d.open) { LV.open.add(k); const x = LV.ev[k]; if (x && !LV.sum[k]) loadSum(x).then(() => S.view === 'live' && renderKeep(), () => { }); } else LV.open.delete(k); }
  if (d.dataset.mf) { const g = games()[S.fg]; const m = g && g.matcher && g.matcher[+d.dataset.mf]; if (!m) return; const k = mkey(m); if (d.open) { LV.open.add('mf:' + k); if (!LV.facts[k]) loadFacts(m).then(() => { const el = document.querySelector(`[data-fx="${CSS.escape(k)}"]`); if (el) el.innerHTML = factsHtml(m); }); } else LV.open.delete('mf:' + k); }
}, true);
