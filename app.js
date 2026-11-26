'use strict';
const TZ = 'Europe/Stockholm';
const S = { data: null, view: 'oversikt', fg: 'stryktipset', tg: 'V75', avd: 0, sortH: 'nr', sg: 'stryktipset', eg: 'stryktipset', sel: load('sel') || {} };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString('sv-SE') + ' %';
const sgn = v => v == null ? '–' : (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toLocaleString('sv-SE');
const kr = v => v.toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' kr';
function load(k) { try { return JSON.parse(localStorage.getItem('ls_' + k)); } catch { return null; } }
function save(k, v) { try { localStorage.setItem('ls_' + k, JSON.stringify(v)); } catch { } }
function fmt(iso, opt) { if (!iso) return '–'; return new Intl.DateTimeFormat('sv-SE', Object.assign({ timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, opt || {})).format(new Date(iso)); }
function left(iso) {
  const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'Spelstopp passerat';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return 'om ' + (d ? d + ' d ' : '') + (h ? h + ' h ' : '') + (d ? '' : m + ' min');
}
const passed = g => g && g.spelstopp && new Date(g.spelstopp) < Date.now();
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); }
const games = () => S.data ? { stryktipset: S.data.fotboll.stryktipset, europatipset: S.data.fotboll.europatipset, topptipset: S.data.fotboll.topptipset, powerplay: (S.data.hockey || {}).powerplay, V75: S.data.trav.V75, V86: S.data.trav.V86 } : {};
const FOOT = ['stryktipset', 'europatipset', 'topptipset', 'powerplay'];
const SPORTNAMN = { stryktipset: 'Stryktipset', europatipset: 'Europatipset', topptipset: 'Topptipset', powerplay: 'Powerplay 🏒', bomben: 'Bomben 💣' };
function skrallTxt(sk, short) {
  if (!sk) return '';
  const b = sk.basta;
  if (!b) return short ? 'Ingen understreckad skräll' : 'Skräll: ingen understreckad skräll – oddsen och folket är överens här.';
  const who = b.tecken ? `${b.tecken} (${b.lag})` : `nr ${b.nr} ${b.namn}`;
  return short ? `Skräll: ${who}` : `Skräll: <b style="color:var(--acc)">${esc(who)}</b> · ${pct(b.chans)} chans mot ${pct(b.streck)} folket (<span class="val-p">${sgn(b.varde)}</span>)`;
}
const skrallLine = (sk) => sk ? `<div class="small" style="margin-top:6px">🎯 ${skrallTxt(sk)}</div>` : '';
const lvl = n => `<span class="chip lv-${esc(n)}">${esc(n)} skrällchans</span>`;
const valCls = v => v == null ? '' : v >= 0 ? 'val-p' : 'val-n';

async function refresh(manual) {
  try {
    const r = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    S.data = await r.json();
    const live = Object.entries(games()).map(([k, g]) => k + ':' + g.omgang);
    Object.keys(S.sel).forEach(id => { if (!live.includes(id)) delete S.sel[id]; }); save('sel', S.sel);
    $('#upd').textContent = 'Senast uppdaterad ' + fmt(S.data.uppdaterad) + ' (svensk tid)';
    render();
    if (manual) toast('Uppdaterat');
  } catch (e) {
    $('#upd').textContent = 'Kunde inte hämta data – visar senast sparade';
    if (!S.data) $('#app').innerHTML = '<div class="loading">Ingen anslutning. Försök igen strax.</div>';
  }
}

function gameHead(g) {
  if (!g || !g.omgang) return `<div class="warn">${esc(g && g.meddelande || 'Ingen omgång just nu.')}</div>`;
  const warn = passed(g) ? `<div class="warn">Spelstopp har passerat för den här omgången. Nästa omgång läggs in automatiskt vid nästa uppdatering.</div>` : '';
  return warn;
}

/* ---------------- Enkla sammanfattningar ---------------- */
function winnerF(m) { // trolig vinnare fotboll/hockey
  if (!m.vinstchans) return m.duell ? 'Spelarduell – inga odds' : 'Odds saknas än';
  const p = m.vinstchans, i = p.indexOf(Math.max(...p)), r = Math.round(p[i]);
  if (i === 1) return `Oavgjort (${r} %)`;
  const n = i === 0 ? m.hemma : m.borta;
  return p[i] < 45 ? `Jämn match · knapp favorit: ${n} (${r} %)` : `${n} (${r} %)`;
}
function winIdxF(m) { if (!m.vinstchans) return -1; return m.vinstchans.indexOf(Math.max(...m.vinstchans)); }
function skrallF(m) { const b = m.skrall && m.skrall.basta; return b ? `${b.tecken === 'X' ? 'Oavgjort' : b.lag} (${b.tecken})` : 'Ingen tydlig skräll'; }
function skrallIdxF(m) { const b = m.skrall && m.skrall.basta; return b ? '1X2'.indexOf(b.tecken) : -1; }
function winH(l) { const hs = l.starter.filter(h => !h.struken && h.vinstchans != null); if (!hs.length) return null; return hs.reduce((a, h) => h.vinstchans > a.vinstchans ? h : a); }
function skrallH(l) { const b = l.skrall && l.skrall.basta; return b ? `nr ${b.nr} ${b.namn}` : 'Ingen tydlig skräll'; }
function strip(items, cls) { return `<div class="strip ${cls || ''}">${items.map(([k, v, cls]) => `<div><span>${k}</span><b class="${cls || ''}">${esc(v)}</b></div>`).join('')}</div>`; }
function stripF(m) {
  return strip([['Trolig vinnare (enligt oddsen)', winnerF(m), 'win'], ['Bästa skräll', skrallF(m), m.skrall && m.skrall.basta ? 'skr' : 'none2'], ['Troligast resultat', m.exakt ? `${m.exakt.topp[0].res} (${Math.round(m.exakt.topp[0].p)} %)` : '–']]);
}
function spikH(l) { // Spik eller gardera, i klartext
  const w = winH(l); if (!w) return null;
  const hs = l.starter.filter(h => !h.struken && h.streck != null);
  const fav = hs.length ? hs.reduce((a, h) => h.streck > a.streck ? h : a) : w;
  const over = (fav.streck ?? 0) - (fav.vinstchans ?? 0);
  if (w.vinstchans >= 40 && (w.streck == null || w.vinstchans - w.streck >= -5)) return { spik: true, t: `Spik: nr ${w.nr} ${w.namn}` };
  if (over >= 8) return { spik: false, t: `Gardera – favoriten nr ${fav.nr} är överspelad` };
  return { spik: false, t: 'Gardera – öppet lopp' };
}
function stripH(l) {
  const w = winH(l), sp = spikH(l);
  return strip([['Trolig vinnare (enligt oddsen)', w ? `nr ${w.nr} ${w.namn} (${Math.round(w.vinstchans)} % chans)` : 'Odds släpps senare', 'win'],
    ['Spik eller gardera?', sp ? sp.t : '–', sp && sp.spik ? 'win' : 'gard'],
    ['Skräll', skrallH(l), l.skrall && l.skrall.basta ? 'skr' : 'none2']], 'one');
}

/* ---------------- Översikt ---------------- */
function vOversikt() {
  const G = games();
  const B = S.data.bomben;
  const rows = Object.entries(G).filter(([k, g]) => g && g.omgang).map(([k, g]) => ({ k, g, t: new Date(g.spelstopp) }));
  if (B && B.omgangar && B.omgangar.length) rows.push({ k: 'bomben', g: { spelstopp: B.omgangar[0].spelstopp }, t: new Date(B.omgangar[0].spelstopp) });
  rows.sort((a, b) => a.t - b.t);
  const cd = rows.map(r => `<div class="li tap" data-go="${r.k.startsWith('V') ? 'trav' : 'fotboll'}" data-g="${r.k}"><span><b>${esc(SPORTNAMN[r.k] || r.k)}</b><br><span class="muted small">Spelstopp ${esc(fmt(r.g.spelstopp))}</span></span><span class="chip">${esc(left(r.g.spelstopp))}</span></div>`).join('');
  const wins = [];
  for (const k of FOOT) { const g = G[k]; g && g.matcher && g.matcher.forEach(m => { const i = winIdxF(m); if (i >= 0 && i !== 1) wins.push({ p: m.vinstchans[i], n: i === 0 ? m.hemma : m.borta, mot: i === 0 ? m.borta : m.hemma, g: SPORTNAMN[k] }); }); }
  for (const k of ['V75', 'V86']) { const g = G[k]; g && g.lopp && g.lopp.forEach(l => { const w = winH(l); if (w) wins.push({ p: w.vinstchans, n: `nr ${w.nr} ${w.namn}`, mot: null, g: `${k} avd ${l.avd}` }); }); }
  wins.sort((a, b) => b.p - a.p);
  const bs = [];
  for (const k of FOOT) { const g = G[k]; g && g.matcher && g.matcher.forEach(m => m.skrall && m.skrall.basta && bs.push({ b: m.skrall.basta, w: skrallF(m), t: `${m.hemma} – ${m.borta} · ${SPORTNAMN[k]}` })); }
  for (const k of ['V75', 'V86']) { const g = G[k]; g && g.lopp && g.lopp.forEach(l => l.skrall && l.skrall.basta && bs.push({ b: l.skrall.basta, w: skrallH(l), t: `${k} avd ${l.avd}` })); }
  bs.sort((x, y) => y.b.varde - x.b.varde);
  const L = S.data.lankar || {};
  const links = (arr) => (arr || []).map(x => `<a href="${esc(x.href)}" target="_blank" rel="noopener">${esc(x.title)}<span>${esc(x.site)}</span></a>`).join('');
  return `<h2>Översikt</h2><p class="lead">Nästa omgångar – uppdateras automatiskt.</p>
  <button class="bigbtn" data-sv="stryktipset">🏆 Bygg Storvinst-kupong</button>
  <div class="chips" style="margin:-4px 0 14px;justify-content:center">${['europatipset', 'topptipset', 'powerplay', 'V75'].map(k => `<button class="chip tapchip" data-sv="${k}">${esc(SPORTNAMN[k] || k)}</button>`).join('')}</div>
  <div class="card"><h3>⏱ Spelstopp</h3><div class="list">${cd}</div></div>
  <div class="card"><h3>✅ Dagens tydligaste vinnare</h3><div class="muted small">Trolig vinnare enligt oddsen – ingen garanti</div><div class="list">${wins.slice(0, 6).map(w => `<div class="li"><span><b class="win">${esc(w.n)}</b>${w.mot ? ` <span class="muted">mot ${esc(w.mot)}</span>` : ''}<br><span class="muted small">${esc(w.g)}</span></span><span class="big2">${Math.round(w.p)} %</span></div>`).join('') || '<div class="none">Inga odds än</div>'}</div></div>
  <div class="card"><h3>🎯 Bästa skrällar</h3><div class="muted small">Mer chans än folket tror</div><div class="list">${bs.slice(0, 6).map(o => `<div class="li"><span><b class="skr">${esc(o.w)}</b><br><span class="muted small">${esc(o.t)}</span></span><span class="small">${Math.round(o.b.chans)} % chans<br><span class="muted">${Math.round(o.b.streck)} % folket</span></span></div>`).join('') || '<div class="none">Inga tydliga skrällar just nu</div>'}</div></div>
  ${(L.sv || L.en) ? `<details class="card"><summary>Källor (svenska & engelska)</summary><div class="links">${links(L.sv)}${links(L.en)}</div></details>` : ''}`;
}

/* ---------------- Bomben ---------------- */
function bombenBody(exaktFokus) {
  const b = S.data.bomben;
  if (!b || !b.omgangar || !b.omgangar.length) return `<div class="warn">${esc(b && b.meddelande || 'Ingen öppen Bomben-omgång just nu.')}</div>`;
  const dist = (arr) => (arr || []).slice().sort((x, y) => y.p - x.p).slice(0, 3).map(x => `<span class="chip">${esc(x.mal)} mål · ${pct(x.p)}</span>`).join(' ');
  return `<div class="warn">${esc(b.info)}</div>` + b.omgangar.map(o => `<div class="xlbl" style="font-size:13px;color:var(--txt)">${esc(o.namn)} · ${esc(o.tema)} (${esc(o.sport)}) · spelstopp ${esc(fmt(o.spelstopp))} · ${esc(left(o.spelstopp))}</div>` +
    o.matcher.map(m => `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">${esc(m.liga || '')} · ${esc(fmt(m.start))}</div>
      ${m.exakt ? `<div class="xlbl">Exakt resultat – modell från odds</div><div class="xcs">${m.exakt.topp.map((t, i) => `<div class="xpill ${i === 0 ? 'gold' : ''}"><div class="r">${t.res}</div><div class="p">${pct(t.p)}</div></div>`).join('')}</div>
        <div class="muted small" style="margin-top:6px">Odds ${m.exakt.odds.map(x => x.toLocaleString('sv-SE', { minimumFractionDigits: 2 })).join(' / ')} (${esc(m.oddsKalla)}) · xG ${m.exakt.xgHemma.toLocaleString('sv-SE')}–${m.exakt.xgBorta.toLocaleString('sv-SE')}${m.exakt.modell.includes('ordinarie') ? ' · ordinarie tid' : ''}</div>`
        : `<div class="muted small" style="margin-top:8px">Matchen finns inte med odds på Stryk/Europa/Topptipset/Powerplay just nu – därför ingen oddsmodell (vi gissar inte).</div>`}
      ${m.folketTopp ? `<div class="xlbl">Folkets mest spelade resultat</div><div class="cs" style="margin-top:0">${m.folketTopp.map(t => `<span class="pill" style="color:var(--blu);border-color:rgba(90,169,255,.3);background:rgba(90,169,255,.1)">${t.res} (${pct(t.p)})</span>`).join('')}</div>
        <div class="muted small" style="margin-top:6px">${esc(m.hemma)}: ${dist(m.folketHemma)}</div><div class="muted small" style="margin-top:4px">${esc(m.borta)}: ${dist(m.folketBorta)}</div>
        <div class="muted small" style="margin-top:4px">Beräknat från folkets streck per lag (Svenska Spel).</div>` : '<div class="muted small">Inga streck än.</div>'}
      </div>`).join('')).join('');
}
function vBomben(seg) { const b = S.data.bomben || {}; return `<h2>Bomben 💣</h2><p class="lead">Öppna Bomben-omgångar (${(b.omgangar || []).length} st) – tippa exakt antal mål per lag.</p>${seg}${bombenBody()}`; }

/* ---------------- Fotboll ---------------- */
function oddsRow(m) {
  const wi = winIdxF(m);
  return `<div class="xodds">${[0, 1, 2].map(i => `<div class="xodd ${i === wi ? 'fav' : ''}"><div class="t">${'1X2'[i]}</div><div class="o">${m.odds ? m.odds[i].toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : '–'}</div><div class="c">${m.vinstchans ? Math.round(m.vinstchans[i]) + ' %' : (m.streck ? 'folket ' + Math.round(m.streck[i]) + ' %' : '–')}</div></div>`).join('')}</div>`;
}
function moreF(m) {
  const a = m.analys || {};
  const bars = [0, 1, 2].map(i => `<div class="mrow"><b>${'1X2'[i]}</b><div style="flex:1"><div class="bar"><i class="o" style="width:${m.vinstchans ? m.vinstchans[i] : 0}%"></i></div><div class="bar"><i class="f" style="width:${m.streck ? m.streck[i] : 0}%"></i></div></div><span class="small">${pct(m.vinstchans && m.vinstchans[i])} / ${pct(m.streck && m.streck[i])}</span></div>`).join('');
  return `<details><summary>Visa mer detaljer & analys</summary>
    <div class="legend"><span><b style="background:var(--acc)"></b>Chans enligt odds</span><span><b style="background:var(--blu)"></b>Folkets streck</span></div>${bars}
    ${m.exakt ? `<div class="muted small" style="margin-top:6px">Fler troliga resultat: ${m.exakt.topp.map(t => `${t.res} (${Math.round(t.p)} %)`).join(' · ')} – räknat från oddsen${m.exakt.modell.includes('ordinarie') ? ', ordinarie tid' : ''}.</div>` : ''}
    ${m.duell ? `<div class="muted small" style="margin-top:6px">Spelarduell: 1 = ${esc(m.hemma)}, X = lika, 2 = ${esc(m.borta)}. Inga odds från Svenska Spel – se deras regler.</div>` : ''}
    <div class="note"><b>SV</b>${a.sv ? esc(a.sv) : '<span class="none">Ingen svensk analys inlagd än.</span>'}</div>
    <div class="note"><b>EN</b>${a.en ? esc(a.en) : '<span class="none">Ingen engelsk analys hittad – vi gissar inte.</span>'}</div></details>`;
}
function matchCard(m) {
  if (m.struken) return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">Matchen är struken – lottas.</div></div>`;
  return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted small">${esc(m.liga || '')} · ${esc(fmt(m.start))}</div>
    ${stripF(m)}${oddsRow(m)}${moreF(m)}</div>`;
}
function vFotboll() {
  const g = games()[S.fg];
  const seg = `<div class="seg">${[...FOOT, 'bomben'].map(k => `<button data-fg="${k}" class="${S.fg === k ? 'on' : ''}">${SPORTNAMN[k]}</button>`).join('')}</div>`;
  if (S.fg === 'bomben') return vBomben(seg);
  if (!g || !g.matcher) return `<h2>Sport</h2>${seg}${gameHead(g)}`;
  return `<h2>${esc(SPORTNAMN[S.fg] || g.namn)}</h2><p class="lead">Spelstopp ${esc(fmt(g.spelstopp))} · ${esc(left(g.spelstopp))}</p>${seg}
   <button class="bigbtn" data-sv="${S.fg}">🏆 Bygg Storvinst för ${esc(SPORTNAMN[S.fg] || g.namn)}</button>${gameHead(g)}
   ${g.matcher.map(matchCard).join('')}`;
}

/* ---------------- Trav ---------------- */
function vTrav() {
  const g = S.data.trav[S.tg];
  const seg = `<div class="seg">${['V75', 'V86'].map(k => `<button data-tg="${k}" class="${S.tg === k ? 'on' : ''}">${k}</button>`).join('')}</div>`;
  if (!g || !g.lopp) return `<h2>Trav</h2>${seg}${gameHead(g)}`;
  if (S.avd >= g.lopp.length) S.avd = 0;
  const l = g.lopp[S.avd];
  const aseg = `<div class="seg">${g.lopp.map((x, i) => `<button data-avd="${i}" class="${S.avd === i ? 'on' : ''}">Avd ${x.avd}</button>`).join('')}</div>`;
  const info = !g.oddsFinns ? `<div class="warn">Odds och streck är inte släppta än – fylls i automatiskt.</div>` : '';
  const w = winH(l), sk = l.skrall && l.skrall.basta;
  const hs = [...l.starter].sort((a, b) => (a.struken - b.struken) || ((b.vinstchans ?? b.streck ?? -1) - (a.vinstchans ?? a.streck ?? -1)) || a.nr - b.nr);
  const a = l.analys || {};
  return `<h2>${esc(g.namn)} · ${esc((g.banor || []).join(' & '))}</h2><p class="lead">Första start ${esc(fmt(g.spelstopp))} · ${esc(left(g.spelstopp))}</p>${seg}
  <button class="bigbtn" data-sv="${S.tg}">🏆 Bygg Storvinst för ${S.tg}</button>${gameHead(g)}${info}${aseg}
  <div class="card"><h3>Avd ${l.avd} · ${esc(l.bana)}</h3><div class="muted small">${esc(fmt(l.start))} · ${l.distans} m ${esc(l.startmetod || '')}start</div>
   ${stripH(l)}
   ${hs.map(h => `<div class="horse ${h.struken ? 'scr' : ''}"><div class="num ${w && h.nr === w.nr ? 'nwin' : ''} ${sk && h.nr === sk.nr ? 'nskr' : ''}">${h.nr}</div>
     <div><b>${esc(h.namn)}</b>${h.struken ? ' · struken' : ''}${w && h.nr === w.nr ? ` <span class="tag twin">${spikH(l) && spikH(l).spik ? 'Spik' : 'Vinnare'}</span>` : ''}${sk && h.nr === sk.nr ? ' <span class="tag tskr">Skräll</span>' : ''}<div class="muted small">${esc(h.kusk)}</div></div>
     <div class="right"><div class="big2">${h.vinstchans != null ? Math.round(h.vinstchans) + ' %' : '–'}</div><div class="muted small">folket ${h.streck != null ? Math.round(h.streck) + ' %' : '–'}</div></div></div>`).join('')}
   <details><summary>Visa mer detaljer & analys</summary>
   ${l.starter.filter(h => !h.struken).map(h => `<div class="muted small" style="padding:3px 0"><b>${h.nr} ${esc(h.namn)}</b> · odds ${h.odds ? h.odds.toLocaleString('sv-SE') : '–'} · form ${h.form && h.form.length ? esc(h.form.join('-')) : '–'} · i år ${h.aret.starter ?? 0} st/${h.aret.segrar ?? 0} seg · rekord ${esc(h.rekord || '–')} · tr. ${esc(h.tranare)}</div>`).join('')}
   <div class="muted small" style="margin-top:6px">${esc(l.namn || '')}</div>
   <div class="note"><b>SV</b>${a.sv ? esc(a.sv) : '<span class="none">Ingen svensk analys inlagd än.</span>'}</div>
   <div class="note"><b>EN</b>${a.en ? esc(a.en) : '<span class="none">Ingen engelsk analys hittad.</span>'}</div></details></div>`;
}

/* ---------------- System ---------------- */
function selFor(k) {
  const g = games()[k]; if (!g || !g.omgang) return null;
  const id = k + ':' + g.omgang;
  if (!S.sel[id]) S.sel[id] = (g.matcher ? g.matcher.map(() => []) : g.lopp.map(() => []));
  return { g, id, s: S.sel[id] };
}
function rank(g, i) { // rangordnade val för match/avd i
  if (g.matcher) { const m = g.matcher[i]; const p = m.vinstchans || m.streck || [34, 33, 33]; return [0, 1, 2].sort((a, b) => p[b] - p[a]); }
  return g.lopp[i].starter.filter(h => !h.struken).sort((a, b) => (b.vinstchans ?? b.streck ?? 0) - (a.vinstchans ?? a.streck ?? 0)).map(h => h.nr);
}
function openness(g, i) { if (g.matcher) { const m = g.matcher[i]; const p = m.vinstchans || m.streck; return p ? 100 - Math.max(...p) : 0; } const l = g.lopp[i]; const xs = l.starter.filter(h => !h.struken).map(h => h.vinstchans ?? h.streck ?? 0); return 100 - Math.max(0, ...xs); }
function preset(k, size) {
  const o = selFor(k); if (!o) return; const g = o.g, n = o.s.length;
  const order = [...Array(n).keys()].sort((a, b) => openness(g, a) - openness(g, b)); // säkrast först
  let counts;
  if (g.matcher) { const P = (n <= 8 ? { lilla: [2, 0], mellan: [3, 1], stora: [4, 2] } : { lilla: [2, 0], mellan: [4, 1], stora: [5, 2] })[size]; counts = Array(n).fill(1); for (let j = 0; j < P[1]; j++) counts[n - 1 - j] = 3; for (let j = 0; j < P[0]; j++) counts[n - 1 - P[1] - j] = 2; }
  else { const base = { lilla: [1, 1, 1, 2, 2, 2, 3, 3], mellan: [1, 1, 2, 2, 3, 3, 4, 4], stora: [1, 2, 2, 3, 3, 4, 4, 5] }[size]; counts = base.slice(base.length - n); }
  order.forEach((idx, j) => { const r = rank(g, idx); o.s[idx] = r.slice(0, Math.min(counts[j], r.length)); });
  save('sel', S.sel); render();
}
function sysCalc(k) { const o = selFor(k); if (!o) return null; const rows = o.s.reduce((a, x) => a * x.length, 1); return { rows, cost: rows * o.g.radpris, o }; }
function sysText(k) {
  const c = sysCalc(k), g = c.o.g;
  const lines = g.matcher ? g.matcher.map((m, i) => `${m.nr}. ${m.hemma} – ${m.borta}: ${c.o.s[i].sort().map(x => '1X2'[x]).join('') || '-'}`)
    : g.lopp.map((l, i) => `Avd ${l.avd}: ${c.o.s[i].sort((a, b) => a - b).join(', ') || '-'}`);
  return `${g.namn} ${g.matcher ? 'omgång ' + g.omgang : g.omgang}\n${lines.join('\n')}\n${c.rows} rader · ${kr(c.cost)}\n(Lejon Spel – endast analys, inga garantier)`;
}
function vSystem() {
  const seg = `<div class="seg">${[['stryktipset', 'Stryk'], ['europatipset', 'Europa'], ['topptipset', 'Topp'], ['powerplay', 'Power'], ['V75', 'V75'], ['V86', 'V86']].map(([k, t]) => `<button data-sg="${k}" class="${S.sg === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const o = selFor(S.sg); const g = games()[S.sg];
  if (!o) return `<h2>Systembyggare</h2>${seg}${gameHead(g)}`;
  const c = sysCalc(S.sg);
  const dots = (win, skr) => `${win ? '<i class="dot dwin"></i>' : ''}${skr ? '<i class="dot dskr"></i>' : ''}`;
  const body = g.matcher ? g.matcher.map((m, i) => { const wi = winIdxF(m), si = skrallIdxF(m); return `<div class="card"><b>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</b>
     <div class="muted small" style="margin:2px 0 8px">Trolig: <span class="win">${esc(winnerF(m))}</span> · Skräll: <span class="skr">${esc(skrallF(m))}</span></div>
     <div class="tbtn">${[0, 1, 2].map(t => `<button data-pick="${i}:${t}" class="${o.s[i].includes(t) ? 'on' : ''}">${dots(t === wi, t === si)}${'1X2'[t]}</button>`).join('')}</div></div>`; }).join('')
    : g.lopp.map((l, i) => { const w = winH(l), sk = l.skrall && l.skrall.basta; return `<div class="card"><b>Avd ${l.avd} · ${esc(l.bana)}</b>
     <div class="muted small" style="margin:2px 0 4px">Trolig: <span class="win">${w ? `nr ${w.nr} ${esc(w.namn)} (${Math.round(w.vinstchans)} %)` : '–'}</span> · Skräll: <span class="skr">${esc(skrallH(l))}</span></div>
     <div class="hgrid">${l.starter.map(h => `<button data-pick="${i}:${h.nr}" class="${o.s[i].includes(h.nr) ? 'on' : ''}" ${h.struken ? 'disabled' : ''}>${dots(w && h.nr === w.nr, sk && h.nr === sk.nr)}${h.nr}</button>`).join('')}</div></div>`; }).join('');
  return `<h2>Systembyggare</h2><p class="lead">${esc(SPORTNAMN[S.sg] || g.namn)} · ${kr(g.radpris)}/rad · spelstopp ${esc(fmt(g.spelstopp))}</p>${seg}${gameHead(g)}
   <div class="card sum"><div class="row"><div><div class="muted small">Rader</div><div class="big">${c.rows.toLocaleString('sv-SE')}</div></div><div style="text-align:right"><div class="muted small">Kostnad</div><div class="big" style="color:var(--acc)">${kr(c.cost)}</div></div></div>
   ${c.rows === 0 ? '<div class="muted small">Tryck på ett tecken/en häst i varje ' + (g.matcher ? 'match' : 'avdelning') + ' – eller välj en färdig kupong nedan.</div>' : ''}
   <div class="pgrid"><button data-preset="lilla">Lilla</button><button data-preset="mellan">Mellan</button><button data-preset="stora">Stora</button><button class="svbtn" data-storvinst="1">🏆 Storvinst</button></div>
   <div class="btns"><button data-clear="1">Rensa</button><button class="btn pri" id="copy">Kopiera system</button></div></div>
   ${storvinstBox(o.id)}
   <div class="dlegend"><span><i class="dot dwin"></i>Trolig vinnare</span><span><i class="dot dskr"></i>Skräll</span></div>
   ${body}
   <p class="muted small" style="margin:10px 4px">Lilla/Mellan/Stora: spikar de säkraste och garderar de öppnaste. 🏆 Storvinst: spikar säkra matcher som få spelar, garderar favoriter som folket överspelar och tar med skrällar. Förslag – ingen garanti.</p>`;
}

/* ---------------- Exakt & Odds ---------------- */
function vExakt() {
  const seg = `<div class="seg">${[['stryktipset', 'Stryk'], ['europatipset', 'Europa'], ['topptipset', 'Topp'], ['powerplay', 'Power 🏒'], ['bomben', 'Bomben 💣'], ['V75', 'V75 Odds']].map(([k, t]) => `<button data-eg="${k}" class="${S.eg === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const g = games()[S.eg];
  if (S.eg === 'bomben') return `<h2>Exakt & Odds · Bomben</h2><p class="lead">Exakt resultat per match i öppna Bomben-omgångar</p>${seg}${bombenBody()}`;
  if (S.eg === 'V75') {
    if (!g || !g.lopp) return `<h2>Exakt & Odds</h2>${seg}${gameHead(g)}`;
    const cards = g.lopp.map(l => {
      const top = l.starter.filter(h => !h.struken).sort((a, b) => (b.vinstchans ?? b.streck ?? -1) - (a.vinstchans ?? a.streck ?? -1)).slice(0, 4);
      return `<div class="card"><h3>Avd ${l.avd} · ${esc(l.bana)}</h3><div class="muted small">${esc(fmt(l.start))} · ${l.distans} m</div>${stripH(l)}
        <div class="xh"><span></span><span>Odds</span><span>Chans</span><span>Folket</span></div>
        ${top.map((h, i) => `<div class="xrow ${i === 0 ? 'first' : ''}"><div><span class="num">${h.nr}</span> <b>${esc(h.namn)}</b></div>
          <div class="xo">${h.odds ? h.odds.toLocaleString('sv-SE') : '–'}</div><div class="xp">${pct(h.vinstchans)}</div><div class="xs">${pct(h.streck)}</div></div>`).join('')}</div>`;
    }).join('');
    return `<h2>V75 Odds</h2><p class="lead">${esc((g.banor || []).join(' & '))} · ${esc(fmt(g.spelstopp))} · topp 4 per avdelning</p>${seg}${gameHead(g)}
      ${!g.oddsFinns ? '<div class="warn">Oddsen är inte släppta än – fylls i automatiskt.</div>' : ''}${cards}`;
  }
  if (!g || !g.matcher) return `<h2>Exakt & Odds</h2>${seg}${gameHead(g)}`;
  const cards = g.matcher.map(m => {
    if (m.struken) return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">Struken – lottas.</div></div>`;
    const cs = m.exakt ? `<div class="xlbl">Troligaste resultat</div><div class="xcs">${m.exakt.topp.map((t, i) => `<div class="xpill ${i === 0 ? 'gold' : ''}"><div class="r">${t.res}</div><div class="p">${Math.round(t.p)} %</div></div>`).join('')}</div>
      <details><summary>Visa mer detaljer</summary><div class="muted small">Räknat från oddsen${S.eg === 'powerplay' ? ' (ordinarie tid, 60 min)' : ''}. Förväntade mål: ${esc(m.hemma)} ${m.exakt.xgHemma.toLocaleString('sv-SE')} – ${m.exakt.xgBorta.toLocaleString('sv-SE')} ${esc(m.borta)}.</div></details>` : `<div class="muted small" style="margin-top:8px">${m.duell ? 'Spelarduell – inga odds, inget resultat att räkna.' : 'Odds saknas än.'}</div>`;
    return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted small">${esc(m.liga || '')} · ${esc(fmt(m.start))}</div>
      ${stripF(m)}<div class="xlbl">Odds 1 / X / 2</div>${oddsRow(m)}${cs}</div>`;
  }).join('');
  return `<h2>Exakt & Odds</h2><p class="lead">${esc(SPORTNAMN[S.eg] || g.namn)} · spelstopp ${esc(fmt(g.spelstopp))} · ${esc(left(g.spelstopp))}</p>${seg}${gameHead(g)}${cards}
    <p class="muted small" style="margin:10px 4px">Odds från Svenska Spel. Resultaten är sannolikheter räknade från oddsen – ingen garanti.</p>`;
}

/* ---------------- 🏆 Storvinst (spelvärde-strategi) ---------------- */
// Bygger på hur poolspel betalar: du delar potten med alla som har samma rad. Därför
// spikas tecken med hög vinstchans OCH rimligt streck (värdespikar), medan överstreckade
// favoriter (folket % >> odds %) garderas eller fälls, och understreckade tecken prioriteras.
const SV_BUDGET = { stryktipset: [192, 384], europatipset: [192, 384], topptipset: [64, 128], powerplay: [64, 128], V75: [200, 400], V86: [200, 400] };
function svLegs(g) {
  if (g.matcher) return g.matcher.map(m => {
    const hasOdds = !!m.vinstchans, p = m.vinstchans || m.streck || [34, 33, 33], f = m.streck || p;
    return { label: `${m.nr}. ${m.hemma} – ${m.borta}`, hasOdds, opts: [0, 1, 2].map(i => ({ key: i, name: '1X2'[i], p: p[i], f: f[i] })) };
  });
  return g.lopp.map(l => {
    const hs = l.starter.filter(h => !h.struken);
    const hasOdds = hs.some(h => h.vinstchans != null);
    return { label: `Avd ${l.avd}`, hasOdds, opts: hs.map(h => ({ key: h.nr, name: `${h.nr} ${h.namn}`, p: hasOdds ? (h.vinstchans ?? 0) : (h.streck ?? 0), f: h.streck ?? (h.vinstchans ?? 0) })) };
  });
}
function storvinst(k) {
  const o = selFor(k); if (!o) return; const g = o.g;
  const legs = svLegs(g);
  if (!legs.some(l => l.hasOdds)) { toast('Odds saknas än – Storvinst kräver odds'); return; }
  const [minKr, maxKr] = SV_BUDGET[k] || [200, 400];
  const maxRows = Math.floor(maxKr / g.radpris);
  const isF = !!g.matcher;
  const spikP = isF ? 50 : 35; // minsta vinstchans för värdespik
  const pick = [], info = legs.map(() => ({}));
  legs.forEach((L, i) => {
    const byP = [...L.opts].sort((a, b) => b.p - a.p);
    const fav = [...L.opts].sort((a, b) => b.f - a.f)[0];       // folkets favorit
    const top = byP[0];
    const over = fav.f - fav.p;                                   // överstreckning i procentenheter
    info[i] = { L, top, fav, over, byP };
    let start;
    if (isF && L.hasOdds && over >= 15 && fav.p < 55 && byP.length === 3) {
      // fäll kraftigt överstreckad favorit: spela de två andra tecknen
      start = L.opts.filter(x => x.key !== fav.key).map(x => x.key); info[i].fall = true;
    } else start = [top.key];
    pick[i] = start;
  });
  // värdespikar: hög chans och spelvärde >= -2, ej överstreckad favorit
  const spikCand = info.map((x, i) => ({ i, x })).filter(({ x }) => x.L.hasOdds && !x.fall && x.top.p >= spikP && (x.top.p - x.top.f) >= -2 && !(x.top.key === x.fav.key && x.over >= 8))
    .sort((a, b) => (b.x.top.p + 2 * (b.x.top.p - b.x.top.f)) - (a.x.top.p + 2 * (a.x.top.p - a.x.top.f)));
  const nSpik = isF ? Math.min(spikCand.length, Math.max(2, Math.round(legs.length / 3))) : Math.min(spikCand.length, 2);
  const locked = new Set(spikCand.slice(0, nSpik).map(c => c.i));
  const rows = () => pick.reduce((a, x) => a * x.length, 1);
  // girig gardering: prioritera överstreckade favoriter och understreckade (positivt EV) alternativ
  for (let guard = 0; guard < 200; guard++) {
    let best = null;
    info.forEach((x, i) => {
      if (locked.has(i)) return;
      const chosen = new Set(pick[i]);
      const rest = x.L.opts.filter(o2 => !chosen.has(o2.key) && !(x.fall && o2.key === x.fav.key));
      if (!rest.length) return;
      if (!isF && pick[i].length >= 5) return;
      const cand = rest.sort((a, b) => (b.p + Math.max(0, b.p - b.f)) - (a.p + Math.max(0, a.p - a.f)))[0];
      const n = pick[i].length, newRows = rows() / n * (n + 1);
      if (newRows > maxRows) return;
      const miss = 100 - x.L.opts.filter(o2 => chosen.has(o2.key)).reduce((a, o2) => a + o2.p, 0);
      const overBonus = (chosen.has(x.fav.key) && x.over > 0 && n <= 2) ? x.over / n : 0;
      const ev = Math.max(0, cand.p - cand.f);
      const score = (Math.min(cand.p, miss) + 1.5 * ev + overBonus) / Math.log((n + 1) / n);
      if (cand.p < (isF ? 12 : 4) && ev < 3) return; // inga rena chansningar
      if (!best || score > best.score) best = { i, key: cand.key, score };
    });
    if (!best) break;
    pick[best.i].push(best.key);
  }
  legs.forEach((L, i) => { o.s[i] = pick[i].slice(); });
  // förklaring – vardaglig svenska
  const prob = legs.reduce((a, L, i) => a * L.opts.filter(x => pick[i].includes(x.key)).reduce((s, x) => s + x.p, 0) / 100, 1);
  const folk = legs.reduce((a, L, i) => a * L.opts.filter(x => pick[i].includes(x.key)).reduce((s, x) => s + x.f, 0) / 100, 1);
  const items = g.matcher || g.lopp;
  const lbl = i => isF ? `Match ${items[i].nr} (${items[i].hemma} – ${items[i].borta})` : `Avd ${items[i].avd}`;
  const sign = (i, key) => isF ? (key === 1 ? 'X (oavgjort)' : `${'1X2'[key]} (${key === 0 ? items[i].hemma : items[i].borta})`) : `nr ${key} ${(items[i].starter.find(h => h.nr === key) || {}).namn || ''}`.trim();
  const list = (i, keys) => { const ks = keys.slice().sort((p1, p2) => p1 - p2); const s = ks.map(k2 => isF ? '1X2'[k2] : 'nr ' + k2); return s.length > 1 ? s.slice(0, -1).join(', ') + ' och ' + s[s.length - 1] : s[0]; };
  const lines = [];
  [...locked].sort((a2, b2) => a2 - b2).forEach(i => { const t = info[i].top; lines.push({ k: 'spik', t: `${lbl(i)}: spik på ${sign(i, t.key)} – vinner i ${Math.round(t.p)} % enligt oddsen och är inte överspelad.` }); });
  legs.forEach((L, i) => { if (!locked.has(i) && pick[i].length === 1) lines.push({ k: 'spik', t: `${lbl(i)}: bara ${sign(i, pick[i][0])} – håller nere priset.` }); });
  info.forEach((x, i) => {
    if (!x.L.hasOdds || x.over < 8) return;
    const favN = isF ? (x.fav.key === 1 ? 'krysset' : (x.fav.key === 0 ? items[i].hemma : items[i].borta)) : `nr ${x.fav.key} ${(items[i].starter.find(h => h.nr === x.fav.key) || {}).namn || ''}`.trim();
    const verb = x.fall ? `vi hoppar över favoriten och spelar ${list(i, pick[i])}` : (pick[i].length > 1 ? `garderas med ${list(i, pick[i])}` : 'spelas ändå ensam för att hålla budgeten');
    lines.push({ k: 'fav', t: `${lbl(i)}: favoriten ${favN} är överspelad (${Math.round(x.fav.f)} % av folket tror på den, oddsen säger ${Math.round(x.fav.p)} %) – ${verb}.` });
  });
  items.forEach((it, i) => { const b = it.skrall && it.skrall.basta; if (!b) return; const key = b.tecken ? '1X2'.indexOf(b.tecken) : b.nr; if (pick[i].includes(key)) lines.push({ k: 'skr', t: `${lbl(i)}: skrällen ${b.tecken ? (b.tecken === 'X' ? 'oavgjort' : b.lag) : 'nr ' + b.nr + ' ' + b.namn} är med – ${Math.round(b.chans)} % chans, men bara ${Math.round(b.streck)} % av folket tror på den.` }); });
  S.expl = S.expl || {};
  S.expl[o.id] = { lines, rows: rows(), cost: rows() * g.radpris, prob: prob * 100, folk: folk * 100, minKr, maxKr };
  save('sel', S.sel); render();
}
function clearExpl() { const o = selFor(S.sg); if (o && S.expl) delete S.expl[o.id]; }
function storvinstBox(id) {
  const e = S.expl && S.expl[id]; if (!e || !e.lines) return '';
  const idx = e.folk > 0 ? e.prob / e.folk : 0;
  const payout = idx >= 1.2 ? ['Högre utdelning än snittet om den sitter', 'val-p'] : idx >= 0.9 ? ['Normal utdelning', ''] : ['Lägre utdelning – många spelar likadant', 'val-n'];
  const sec = (k, h) => { const L = e.lines.filter(x => x.k === k); return L.length ? `<div class="xlbl">${h}</div>${L.map(x => `<div class="note">${esc(x.t)}</div>`).join('')}` : ''; };
  return `<div class="card" style="border-color:rgba(255,196,0,.45)">
    <div><b>🏆 Storvinst-läge:</b> spikar säkra matcher som få spelar och garderar favoriter som folket överspelar.</div>
    <div class="chips" style="margin-top:8px"><span class="chip">Träffchans ${pct(e.prob)}</span><span class="chip ${payout[1]}">${payout[0]}</span></div>
    <div class="muted small" style="margin-top:6px">${e.rows.toLocaleString('sv-SE')} rader · ${kr(e.cost)} · ingen garanti för vinst</div>
    <details><summary>Visa hur kupongen byggdes</summary>${sec('spik', '✅ Spikar')}${sec('fav', '🛡 Överspelade favoriter')}${sec('skr', '🎯 Skrällar som är med')}
      <div class="muted small" style="margin-top:8px">Träffchans = chansen att allt sitter enligt oddsen. Strecken ändras fram till spelstopp – tryck 🏆 Storvinst igen nära spelstopp.</div></details></div>`;
}

/* ---------------- Render & events ---------------- */
function render() {
  if (!S.data) return;
  const v = { oversikt: vOversikt, fotboll: vFotboll, trav: vTrav, exakt: vExakt, system: vSystem }[S.view] || vOversikt;
  $('#app').innerHTML = v();
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  document.querySelectorAll('.seg button.on').forEach(b => { const p = b.parentElement; p.scrollLeft = b.offsetLeft - (p.clientWidth - b.offsetWidth) / 2; });
}
function go(v) { S.view = v; save('view', v); render(); window.scrollTo({ top: 0 }); }
document.addEventListener('click', e => {
  const b = e.target.closest('button,[data-go]'); if (!b) return;
  const d = b.dataset;
  if (d.v) return go(d.v);
  if (d.sv) { S.sg = d.sv; S.view = 'system'; save('view', 'system'); storvinst(d.sv); render(); window.scrollTo({ top: 0 }); return; }
  if (d.go) { if (d.go === 'fotboll') S.fg = d.g; else { S.tg = d.g; S.avd = 0; } return go(d.go); }
  if (d.fg) { S.fg = d.fg; return render(); }
  if (d.tg) { S.tg = d.tg; S.avd = 0; return render(); }
  if (d.avd) { S.avd = +d.avd; return render(); }
  if (d.sort) { S.sortH = d.sort; return render(); }
  if (d.eg) { S.eg = d.eg; return render(); }
  if (d.sg) { S.sg = d.sg; return render(); }
  if (d.storvinst) return storvinst(S.sg);
  if (d.preset) { clearExpl(); return preset(S.sg, d.preset); }
  if (d.clear || d.pick) clearExpl();
  if (d.clear) { const o = selFor(S.sg); o.s.forEach((_, i) => o.s[i] = []); save('sel', S.sel); return render(); }
  if (d.pick) { const [i, t] = d.pick.split(':').map(Number); const o = selFor(S.sg); const a = o.s[i]; const j = a.indexOf(t); j >= 0 ? a.splice(j, 1) : a.push(t); save('sel', S.sel); const y = window.scrollY; render(); window.scrollTo({ top: y }); return; }
  if (b.id === 'copy') { const t = sysText(S.sg); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('System kopierat'), () => { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('System kopierat'); }); }
  if (b.id === 'refresh') refresh(true);
});
S.view = (['oversikt','fotboll','trav','exakt','system'].includes(location.hash.slice(1)) && location.hash.slice(1)) || load('view') || 'oversikt';
refresh();
setInterval(refresh, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
