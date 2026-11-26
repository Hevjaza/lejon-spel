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

/* ---------------- Översikt ---------------- */
function vOversikt() {
  const G = games();
  const tiles = Object.entries(G).map(([k, g]) => {
    if (!g || !g.omgang) return `<div class="card"><div class="row"><h3>${esc(SPORTNAMN[k] || k)}</h3></div><div class="muted">${esc(g && g.meddelande || '')}</div></div>`;
    const isF = !!g.matcher;
    const sub = isF ? `Omgång ${g.omgang} · ${g.matcher.length} matcher` : `${(g.banor || []).join(' & ')} · ${g.lopp.length} avd`;
    return `<div class="card hero" data-go="${isF ? 'fotboll' : 'trav'}" data-g="${k}"><div class="row"><h3>${esc(SPORTNAMN[k] || g.namn)}</h3><span class="chip">${esc(left(g.spelstopp))}</span></div>
      <div class="muted">${esc(sub)}</div><div class="muted">Spelstopp ${esc(fmt(g.spelstopp))}${g.omsattning ? ' · Omsättning ' + Math.round(g.omsattning).toLocaleString('sv-SE') + ' kr' : ''}</div></div>`;
  }).join('');
  const outs = [];
  for (const k of FOOT) {
    const g = G[k]; if (!g || !g.matcher) continue;
    g.matcher.forEach(m => { if (m.vinstchans) m.vinstchans.forEach((p, i) => outs.push({ g: g.namn, m, t: '1X2'[i], p, v: m.spelvarde ? m.spelvarde[i] : null, f: m.streck ? m.streck[i] : null })); });
  }
  const favs = [...outs].sort((a, b) => b.p - a.p).slice(0, 5);
  const vals = outs.filter(o => o.v != null && o.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
  const horses = [];
  for (const k of ['V75', 'V86']) { const g = G[k]; if (!g || !g.lopp) continue; g.lopp.forEach(l => l.starter.forEach(h => { if (!h.struken && h.spelvarde != null) horses.push({ g: k, l, h }); })); }
  const hv = horses.sort((a, b) => b.h.spelvarde - a.h.spelvarde).slice(0, 5);
  const skr = [];
  for (const k of FOOT) { const g = G[k]; g && g.matcher && g.matcher.forEach(m => m.skrall && m.skrall.niva === 'Hög' && skr.push(`<div class="li"><span>${esc(g.namn)} ${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</span><span class="chip lv-Hög">${pct(m.skrall.procent)}</span></div>`)); }
  for (const k of ['V75', 'V86']) { const g = G[k]; g && g.lopp && g.lopp.forEach(l => l.skrall && l.skrall.niva === 'Hög' && skr.push(`<div class="li"><span>${k} avd ${l.avd} (${esc(l.bana)})</span><span class="chip lv-Hög">${pct(l.skrall.procent)}</span></div>`)); }
  const cs = [];
  for (const k of FOOT) { const g = G[k]; g && g.matcher && g.matcher.forEach(m => m.exakt && cs.push({ g: g.namn, m, t: m.exakt.topp[0] })); }
  cs.sort((a, b) => b.t.p - a.t.p);
  const li = (l, r, cls) => `<div class="li"><span>${l}</span><span class="${cls || ''}"><b>${r}</b></span></div>`;
  const L = S.data.lankar || {};
  const links = (arr) => (arr || []).map(x => `<a href="${esc(x.href)}" target="_blank" rel="noopener">${esc(x.title)}<span>${esc(x.site)}</span></a>`).join('');
  const B = S.data.bomben;
  const btile = B && B.omgangar && B.omgangar.length ? `<div class="card hero" data-go="fotboll" data-g="bomben"><div class="row"><h3>Bomben 💣</h3><span class="chip">${esc(left(B.omgangar[0].spelstopp))}</span></div><div class="muted">${B.omgangar.length} öppna omgångar · nästa: ${esc(B.omgangar[0].tema)}</div><div class="muted">Spelstopp ${esc(fmt(B.omgangar[0].spelstopp))}</div></div>` : '';
  return `<h2>Översikt</h2><p class="lead">Nästa öppna omgångar hämtas automatiskt från Svenska Spel och ATG – spelade omgångar tas bort.</p>
  <div class="cols">${tiles}${btile}</div>
  <div class="cols" style="margin-top:12px">
  <div class="card"><h3>Starkaste favoriter</h3><div class="muted">Högst vinstchans enligt oddsen</div><div class="list">${favs.map(o => li(`${esc(o.g)} ${o.m.nr}. ${esc(o.m.hemma)} – ${esc(o.m.borta)} <b>${o.t}</b>`, pct(o.p))).join('') || '<div class="none">Inga odds än</div>'}</div></div>
  <div class="card"><h3>Bäst spelvärde – fotboll</h3><div class="muted">Vinstchans minus folkets streck</div><div class="list">${vals.map(o => li(`${esc(o.g)} ${o.m.nr}. ${esc(o.m.hemma)} – ${esc(o.m.borta)} <b>${o.t}</b> <span class="muted">(${pct(o.p)} mot ${pct(o.f)})</span>`, sgn(o.v), 'val-p')).join('') || '<div class="none">Inget tydligt spelvärde just nu</div>'}</div></div>
  <div class="card"><h3>Bäst spelvärde – trav</h3><div class="muted">Understreckade hästar</div><div class="list">${hv.map(o => li(`${o.g} avd ${o.l.avd}: <b>${o.h.nr} ${esc(o.h.namn)}</b> <span class="muted">(${pct(o.h.vinstchans)} mot ${pct(o.h.streck)})</span>`, sgn(o.h.spelvarde), o.h.spelvarde >= 0 ? 'val-p' : 'val-n')).join('') || '<div class="none">Odds och streck släpps närmare tävlingsdagen</div>'}</div></div>
  <div class="card"><h3>Skrällvarning</h3><div class="muted">Hög risk att folkets favorit inte vinner</div><div class="list">${skr.join('') || '<div class="none">Inga matcher/lopp med hög skrällchans</div>'}</div></div>
  <div class="card"><h3>Exakt resultat – troligast</h3><div class="muted">Modell från odds (Poisson)</div><div class="list">${cs.slice(0, 6).map(o => li(`${esc(o.g)} ${o.m.nr}. ${esc(o.m.hemma)} – ${esc(o.m.borta)}`, `${o.t.res} (${pct(o.t.p)})`)).join('') || '<div class="none">Inga odds än</div>'}</div></div>
  </div>
  ${(L.sv || L.en) ? `<div class="cols" style="margin-top:12px"><div class="card links"><h3>Svenska källor</h3>${links(L.sv)}</div><div class="card links"><h3>Engelska källor</h3>${links(L.en)}</div></div>` : ''}
  <p class="muted" style="margin:14px 4px">Vinstchans = oddsen omräknade till procent med spelbolagets marginal borttagen. Spelvärde = vinstchans minus andel av folket som streckat. Exakt resultat är en statistisk modell, inte en garanti.</p>`;
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
function matchCard(m) {
  if (m.struken) return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">Matchen är struken – lottas.</div></div>`;
  const duell = m.duell ? `<div class="warn" style="margin:10px 0 0">Spelarduell (Head to Head): 1 = ${esc(m.hemma)}, X = lika, 2 = ${esc(m.borta)}. Svenska Spel visar inga odds för duellen – bara folkets streck. Se Svenska Spels regler för vad som räknas.</div>` : '';
  const oc = [0, 1, 2].map(i => `<div class="oc"><div class="s">${'1X2'[i]}</div><div class="p">${pct(m.vinstchans && m.vinstchans[i])}</div>
    <div class="muted small">odds ${m.odds ? m.odds[i].toLocaleString('sv-SE') : '–'}</div>
    <div class="bar"><i class="o" style="width:${m.vinstchans ? m.vinstchans[i] : 0}%"></i></div>
    <div class="bar"><i class="f" style="width:${m.streck ? m.streck[i] : 0}%"></i></div>
    <div class="muted small">folket ${pct(m.streck && m.streck[i])}</div>
    <div class="small ${valCls(m.spelvarde && m.spelvarde[i])}"><b>${m.spelvarde ? sgn(m.spelvarde[i]) : '–'}</b> värde</div></div>`).join('');
  const cs = m.exakt ? `<div class="cs"><span class="muted small">Exakt resultat:</span>${m.exakt.topp.map(t => `<span class="pill">${t.res} (${Math.round(t.p)}%)</span>`).join('')}</div><div class="muted small" style="margin-top:4px">Modell från odds${m.exakt.modell.includes('ordinarie') ? ' (ordinarie tid)' : ''} · förväntade mål ${m.exakt.xgHemma.toLocaleString('sv-SE')}–${m.exakt.xgBorta.toLocaleString('sv-SE')}</div>` : '';
  const a = m.analys || {};
  return `<div class="card"><div class="row"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3>${m.skrall ? lvl(m.skrall.niva) : ''}</div>
   <div class="muted">${esc(m.liga || '')}${m.land ? ' · ' + esc(m.land) : ''} · ${esc(fmt(m.start))}</div>
   ${m.duell ? '<span class="chip">Spelarduell</span>' : ''}<div class="grid3">${oc}</div>${duell}${cs}
   ${m.skrall ? `<div class="muted small" style="margin-top:8px">Folkets favorit <b>${m.skrall.folketsFavorit}</b> förlorar enligt oddsen i ${pct(m.skrall.procent)} av fallen.</div>` : ''}
   <details><summary>Analys (svenska & engelska)</summary>
   <div class="note"><b>SV</b>${a.sv ? esc(a.sv) : '<span class="none">Ingen svensk expertanalys inlagd för den här matchen än.</span>'}</div>
   <div class="note"><b>EN</b>${a.en ? esc(a.en) : '<span class="none">Ingen engelsk förhandsanalys hittad (vanligt för lägre ligor) – vi gissar inte.</span>'}</div></details></div>`;
}
function vFotboll() {
  const g = games()[S.fg];
  const seg = `<div class="seg">${[...FOOT, 'bomben'].map(k => `<button data-fg="${k}" class="${S.fg === k ? 'on' : ''}">${SPORTNAMN[k]}</button>`).join('')}</div>`;
  if (S.fg === 'bomben') return vBomben(seg);
  if (!g || !g.matcher) return `<h2>Sport</h2>${seg}${gameHead(g)}`;
  return `<h2>${esc(SPORTNAMN[S.fg] || g.namn)}</h2><p class="lead">Omgång ${g.omgang} · spelstopp ${esc(fmt(g.spelstopp))} (${esc(left(g.spelstopp))})${g.streckUppdaterat ? ' · streck ' + esc(fmt(g.streckUppdaterat)) : ''}</p>${seg}${gameHead(g)}
   <div class="legend"><span><b style="background:var(--acc)"></b>Vinstchans (odds)</span><span><b style="background:var(--blu)"></b>Folkets streck</span></div>
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
  const info = !g.oddsFinns || !g.streckFinns ? `<div class="warn">${!g.streckFinns ? 'Streck' : ''}${!g.streckFinns && !g.oddsFinns ? ' och odds' : (!g.oddsFinns ? 'Odds' : '')} är inte släppta än för ${esc(g.namn)} – startlistan visas, vinstchans och spelvärde fylls i automatiskt när ATG öppnar spelet.</div>` : '';
  let hs = [...l.starter];
  if (S.sortH === 'chans') hs.sort((a, b) => (b.vinstchans ?? b.streck ?? -1) - (a.vinstchans ?? a.streck ?? -1));
  if (S.sortH === 'varde') hs.sort((a, b) => (b.spelvarde ?? -99) - (a.spelvarde ?? -99));
  const a = l.analys || {};
  return `<h2>${esc(g.namn)} · ${esc((g.banor || []).join(' & '))}</h2><p class="lead">Första start ${esc(fmt(g.spelstopp))} (${esc(left(g.spelstopp))}) · ${kr(g.radpris)}/rad</p>${seg}${gameHead(g)}${info}${aseg}
  <div class="card"><div class="row"><h3>Avd ${l.avd} · ${esc(l.bana)}</h3>${l.skrall ? lvl(l.skrall.niva) : ''}</div>
   <div class="muted">${esc(fmt(l.start))} · ${l.distans} m ${esc(l.startmetod || '')}start</div><div class="muted small">${esc(l.namn || '')}</div>
   ${l.skrall ? `<div class="muted small" style="margin-top:6px">Folkets favorit nr <b>${l.skrall.folketsFavorit}</b> vinner inte enligt oddsen i ${pct(l.skrall.procent)} av fallen.</div>` : ''}
   <details ${a.sv || a.en ? 'open' : ''}><summary>Analys (svenska & engelska)</summary>
   <div class="note"><b>SV</b>${a.sv ? esc(a.sv) : '<span class="none">Ingen svensk expertanalys inlagd för loppet än.</span>'}</div>
   <div class="note"><b>EN</b>${a.en ? esc(a.en) : '<span class="none">Ingen engelsk analys hittad – svensk trav täcks sällan på engelska.</span>'}</div></details></div>
  <div class="seg">${[['nr', 'Startnummer'], ['chans', 'Vinstchans'], ['varde', 'Spelvärde']].map(([k, t]) => `<button data-sort="${k}" class="${S.sortH === k ? 'on' : ''}">${t}</button>`).join('')}</div>
  <div class="legend"><span><b style="background:var(--acc)"></b>Vinstchans (odds)</span><span><b style="background:var(--blu)"></b>Streck</span></div>
  <div class="card">${hs.map(h => `<div class="horse ${h.struken ? 'scr' : ''}"><div class="num">${h.nr}</div>
     <div><div><b>${esc(h.namn)}</b>${h.struken ? ' · struken' : ''}</div><div class="muted small">${esc(h.kusk)} · tr. ${esc(h.tranare)}</div>
     <div class="muted small">Form ${h.form && h.form.length ? esc(h.form.join('-')) : '–'} · i år ${h.aret.starter ?? 0} st/${h.aret.segrar ?? 0} seg · rek ${esc(h.rekord || '–')}${h.odds ? ' · odds ' + h.odds.toLocaleString('sv-SE') : ''}</div>
     <div class="bar"><i class="o" style="width:${h.vinstchans || 0}%"></i></div><div class="bar"><i class="f" style="width:${h.streck || 0}%"></i></div></div>
     <div class="right"><div><b>${pct(h.vinstchans)}</b></div><div class="muted">${pct(h.streck)} str</div><div class="${valCls(h.spelvarde)}"><b>${sgn(h.spelvarde)}</b></div></div></div>`).join('')}</div>`;
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
  const body = g.matcher ? g.matcher.map((m, i) => `<div class="card"><div class="row"><b>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</b>${m.skrall ? lvl(m.skrall.niva) : ''}</div>
     <div class="muted small" style="margin:2px 0 8px">Chans ${m.vinstchans ? m.vinstchans.map(Math.round).join('/') : '–'} % · Folket ${m.streck ? m.streck.map(Math.round).join('/') : '–'} %${m.exakt ? ' · troligast ' + m.exakt.topp[0].res : ''}</div>
     <div class="tbtn">${[0, 1, 2].map(t => `<button data-pick="${i}:${t}" class="${o.s[i].includes(t) ? 'on' : ''}">${'1X2'[t]}</button>`).join('')}</div></div>`).join('')
    : g.lopp.map((l, i) => `<div class="card"><div class="row"><b>Avd ${l.avd} · ${esc(l.bana)}</b>${l.skrall ? lvl(l.skrall.niva) : ''}</div>
     <div class="muted small">Toppchans: ${rank(g, i).slice(0, 3).map(nr => { const h = l.starter.find(x => x.nr === nr); return `${nr} ${esc(h.namn)} (${pct(h.vinstchans ?? h.streck)})`; }).join(' · ')}</div>
     <div class="hgrid">${l.starter.map(h => `<button data-pick="${i}:${h.nr}" class="${o.s[i].includes(h.nr) ? 'on' : ''}" ${h.struken ? 'disabled' : ''}>${h.nr}</button>`).join('')}</div></div>`).join('');
  return `<h2>Systembyggare</h2><p class="lead">${esc(SPORTNAMN[S.sg] || g.namn)} ${g.matcher ? 'omgång ' + g.omgang : ''} · ${kr(g.radpris)}/rad · spelstopp ${esc(fmt(g.spelstopp))}</p>${seg}${gameHead(g)}
   <div class="card sum"><div class="row"><div><div class="muted small">Rader</div><div class="big">${c.rows.toLocaleString('sv-SE')}</div></div><div style="text-align:right"><div class="muted small">Kostnad</div><div class="big" style="color:var(--acc)">${kr(c.cost)}</div></div></div>
   ${c.rows === 0 ? '<div class="muted small">Välj minst ett tecken/en häst i varje ' + (g.matcher ? 'match' : 'avdelning') + '.</div>' : ''}
   <div class="btns"><button data-preset="lilla">Lilla</button><button data-preset="mellan">Mellan</button><button data-preset="stora">Stora</button><button data-clear="1">Rensa</button></div>
   <div class="btns"><button class="btn pri" id="copy">Kopiera system</button></div></div>
   ${body}
   <p class="muted" style="margin:10px 4px">Lilla/Mellan/Stora: spikar de säkraste enligt oddsen och garderar de öppnaste matcherna/loppen. Det är ett förslag – inte en garanti.</p>`;
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
      return `<div class="card"><div class="row"><h3>Avd ${l.avd} · ${esc(l.bana)}</h3>${l.skrall ? lvl(l.skrall.niva) : ''}</div><div class="muted">${esc(fmt(l.start))} · ${l.distans} m ${esc(l.startmetod || '')}start</div>
        <div class="xh"><span></span><span>Vinnarodds</span><span>Vinstchans</span><span>Streck</span></div>
        ${top.map((h, i) => `<div class="xrow ${i === 0 ? 'first' : ''}"><div><span class="num">${h.nr}</span> <b>${esc(h.namn)}</b><div class="muted small">${esc(h.kusk)}</div></div>
          <div class="xo">${h.odds ? h.odds.toLocaleString('sv-SE') : '–'}</div><div class="xp">${pct(h.vinstchans)}</div><div class="xs">${pct(h.streck)}</div></div>`).join('')}</div>`;
    }).join('');
    return `<h2>V75 Odds</h2><p class="lead">${esc((g.banor || []).join(' & '))} · första start ${esc(fmt(g.spelstopp))} (${esc(left(g.spelstopp))}) · topp 4 per avdelning</p>${seg}${gameHead(g)}
      ${!g.oddsFinns ? '<div class="warn">Vinnaroddsen är inte släppta än – fylls i automatiskt.</div>' : ''}${cards}
      <p class="muted" style="margin:10px 4px">Vinnarodds från ATG. Vinstchans = oddsen omräknade till procent (marginal borttagen). Streck = andel av V75-spelarna.</p>`;
  }
  if (!g || !g.matcher) return `<h2>Exakt & Odds</h2>${seg}${gameHead(g)}`;
  const cards = g.matcher.map(m => {
    if (m.struken) return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">Struken – lottas.</div></div>`;
    if (m.duell) return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">${esc(m.liga || '')} · ${esc(fmt(m.start))} · <span class="chip">Spelarduell</span></div><div class="xlbl">Folkets streck 1 / X / 2</div><div class="xodds">${[0, 1, 2].map(i => `<div class="xodd"><div class="t">${'1X2'[i]}</div><div class="o">${pct(m.streck && m.streck[i])}</div><div class="c">inga odds</div></div>`).join('')}</div><div class="muted small" style="margin-top:6px">Svenska Spel visar inga odds för spelarduellen, så exakt resultat räknas inte.</div></div>`;
    const odds = [0, 1, 2].map(i => `<div class="xodd"><div class="t">${'1X2'[i]}</div><div class="o">${m.odds ? m.odds[i].toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : '–'}</div><div class="c">${pct(m.vinstchans && m.vinstchans[i])}</div></div>`).join('');
    const cs = m.exakt ? `<div class="xlbl">Exakt resultat</div><div class="xcs">${m.exakt.topp.map((t, i) => `<div class="xpill ${i === 0 ? 'gold' : ''}"><div class="r">${t.res}</div><div class="p">${pct(t.p)}</div></div>`).join('')}</div>
      <div class="muted small" style="margin-top:6px">Modell från odds${S.eg === 'powerplay' ? ' (ordinarie tid)' : ''} · xG ${esc(m.hemma)} ${m.exakt.xgHemma.toLocaleString('sv-SE')} – ${m.exakt.xgBorta.toLocaleString('sv-SE')} ${esc(m.borta)}</div>` : '<div class="muted small">Odds saknas – exakt resultat kan inte räknas än.</div>';
    return `<div class="card"><h3>${m.nr}. ${esc(m.hemma)} – ${esc(m.borta)}</h3><div class="muted">${esc(m.liga || '')} · ${esc(fmt(m.start))}</div>
      <div class="xlbl">Odds 1 / X / 2</div><div class="xodds">${odds}</div>${cs}</div>`;
  }).join('');
  return `<h2>Exakt & Odds</h2><p class="lead">${esc(SPORTNAMN[S.eg] || g.namn)} omgång ${g.omgang} · spelstopp ${esc(fmt(g.spelstopp))} (${esc(left(g.spelstopp))})</p>${seg}${gameHead(g)}${cards}
    <p class="muted" style="margin:10px 4px">Odds från Svenska Spel. Exakt resultat är en Poisson-modell räknad från oddsen – en sannolikhet, ingen garanti.${S.eg === 'powerplay' ? ' Hockey: 1X2 och resultat gäller ordinarie tid (60 min).' : ''}</p>`;
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
  if (d.go) { if (d.go === 'fotboll') S.fg = d.g; else { S.tg = d.g; S.avd = 0; } return go(d.go); }
  if (d.fg) { S.fg = d.fg; return render(); }
  if (d.tg) { S.tg = d.tg; S.avd = 0; return render(); }
  if (d.avd) { S.avd = +d.avd; return render(); }
  if (d.sort) { S.sortH = d.sort; return render(); }
  if (d.eg) { S.eg = d.eg; return render(); }
  if (d.sg) { S.sg = d.sg; return render(); }
  if (d.preset) return preset(S.sg, d.preset);
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
