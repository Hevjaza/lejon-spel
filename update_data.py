#!/usr/bin/env python3
"""Lejon Spel – hämtar nästa öppna omgångar från Svenska Spels och ATG:s publika API:er
och skriver data.json. Inga nycklar behövs. Endast standardbiblioteket.

  python3 update_data.py            # skriver data.json
  python3 update_data.py --no-form  # hoppar över formhämtning per häst (snabbare)

Allt i data.json kommer direkt från API:erna, förutom:
  * vinstchans  = 1/odds normaliserat (marginalen borttagen)
  * spelvärde   = vinstchans - streck (procentenheter)
  * exakt resultat = Poisson-modell anpassad till 1X2-oddsen ("Modell från odds")
  * analystexter från notes.json (läggs in av Grok Bot-rutinen, aldrig gissade)
"""
import json, math, os, sys, time, urllib.request, concurrent.futures as cf
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Stockholm")
HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (LejonSpel data updater)", "Accept": "application/json"}
SS = "https://api.spela.svenskaspel.se/draw/1/{p}/draws"
ATG = "https://www.atg.se/services/racinginfo/v1/api"
TRAV_PRICE = {"V75": 0.50, "V86": 0.25}
FOOT_PRICE = 1.0


_CACHE = {}


def get(url, tries=3):
    if url in _CACHE:
        return _CACHE[url]
    _CACHE[url] = _get(url, tries)
    return _CACHE[url]


def _get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa
            err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {err}")


def num(s):
    if s is None or s == "":
        return None
    try:
        return float(str(s).replace(",", "."))
    except ValueError:
        return None


def now():
    return datetime.now(TZ)


def iso(dt):
    return dt.astimezone(TZ).isoformat(timespec="minutes")


def parse(ts):
    dt = datetime.fromisoformat(ts)
    return dt if dt.tzinfo else dt.replace(tzinfo=TZ)


def level(p, lo, hi):
    return "Låg" if p < lo else ("Medel" if p < hi else "Hög")


# ---------------- Exakt resultat (Poisson) ----------------
def pois(k, lam):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def outcome_probs(lh, la, n=10):
    ph = [pois(i, lh) for i in range(n)]
    pa = [pois(i, la) for i in range(n)]
    h = d = a = 0.0
    for i in range(n):
        for j in range(n):
            p = ph[i] * pa[j]
            if i > j: h += p
            elif i == j: d += p
            else: a += p
    return h, d, a


def fit_lambdas(p1, px, p2, prior_total=None, max_l=4.0):
    """Minsta kvadrat-anpassning av hemma/borta-målförväntan till 1X2-sannolikheterna."""
    best = None
    pen = lambda lh, la: 0.0005 * (lh + la - prior_total) ** 2 if prior_total else 0.0
    top = int(max_l * 100)
    for i in range(10, top, 5):          # grovt rutnät 0.10–max_l
        for j in range(10, top, 5):
            lh, la = i / 100, j / 100
            h, d, a = outcome_probs(lh, la, 12)
            e = (h - p1) ** 2 + (d - px) ** 2 + (a - p2) ** 2 + pen(lh, la)
            if best is None or e < best[0]:
                best = (e, lh, la)
    _, bh, ba = best
    for i in range(-5, 6):               # finjustering ±0.05
        for j in range(-5, 6):
            lh, la = max(0.05, bh + i / 100), max(0.05, ba + j / 100)
            h, d, a = outcome_probs(lh, la, 14)
            e = (h - p1) ** 2 + (d - px) ** 2 + (a - p2) ** 2 + pen(lh, la)
            if e < best[0]:
                best = (e, lh, la)
    return best[1], best[2]


def correct_scores(p1, px, p2, top=3, sport="fotboll"):
    if sport == "hockey":   # ordinarie tid, ca 5,8 mål/match som utgångsläge
        lh, la = fit_lambdas(p1, px, p2, prior_total=5.8, max_l=7.0)
    else:
        lh, la = fit_lambdas(p1, px, p2)
    grid = [(pois(i, lh) * pois(j, la), i, j) for i in range(12) for j in range(12)]
    grid.sort(reverse=True)
    return {
        "modell": "Modell från odds (Poisson anpassad till 1X2-oddsen" + (", ordinarie tid, utgångsläge ~5,8 mål)" if sport == "hockey" else ")"),
        "xgHemma": round(lh, 2), "xgBorta": round(la, 2),
        "topp": [{"res": f"{i}–{j}", "p": round(p * 100, 1)} for p, i, j in grid[:top]],
    }


# ---------------- Fotboll ----------------
def tname(p):
    p = p or {}
    n = (p.get("name") or "").strip()
    med = (p.get("mediumName") or "").strip()
    if n and len(n) <= 16:
        return n
    truncated = med and n.startswith(med) and len(med) < len(n) and n[len(med)] != " "
    if med and not truncated:
        return med
    return n.split()[0] if n else (med or None)


ODDS_BY_MATCH = {}   # matchId -> (odds-baserad exakt-modell, källa) för Bomben

def football(product, notes, sport="fotboll", endpoint=None, product_id=None):
    data = get(SS.format(p=endpoint or product))
    t = now()
    draws = [d for d in data.get("draws", []) if parse(d["regCloseTime"]) > t
             and (product_id is None or d.get("productId") == product_id)]
    # fyll odds-uppslag för Bomben från alla öppna omgångar i produkten
    for dd in data.get("draws", []):
        for ev in dd.get("drawEvents", []):
            mid = (ev.get("match") or {}).get("matchId")
            o = ev.get("odds") or {}
            od = [num(o.get("one")), num(o.get("x")), num(o.get("two"))]
            if mid and all(od) and mid not in ODDS_BY_MATCH and ev.get("participantType") != "Player":
                ODDS_BY_MATCH[mid] = (od, f"{dd.get('productName', product)} {dd.get('drawNumber')}", sport)
    draws.sort(key=lambda d: parse(d["regCloseTime"]))
    open_ = [d for d in draws if d.get("drawState") == "Open"]
    if not (open_ or draws):
        return {"id": product, "namn": product.capitalize(), "status": "ingen",
                "meddelande": "Nästa omgång har inte släppts än – appen visar den så fort Svenska Spel öppnar den."}
    d = (open_ or draws)[0]
    matcher = []
    for ev in d.get("drawEvents", []):
        m = ev.get("match") or {}
        parts = {p["type"]: p for p in m.get("participants", [])}
        home, away = tname(parts.get("home")), tname(parts.get("away"))
        if not home:
            home, _, away = ev.get("eventDescription", "").partition(" - ")
        o = ev.get("odds") or {}
        odds = [num(o.get("one")), num(o.get("x")), num(o.get("two"))]
        sf = ev.get("svenskaFolket") or {}
        streck = [num(sf.get("one")), num(sf.get("x")), num(sf.get("two"))]
        row = {
            "nr": ev["eventNumber"], "matchId": m.get("matchId"), "hemma": home, "borta": away,
            "liga": (m.get("league") or {}).get("name"),
            "land": ((m.get("league") or {}).get("country") or {}).get("name"),
            "start": m.get("matchStart"), "status": m.get("status"),
            "struken": bool(ev.get("cancelled")),
            "duell": ev.get("participantType") == "Player",
            "odds": odds if all(odds) else None, "streck": streck if all(x is not None for x in streck) else None,
        }
        row.update(live_fields(m))
        if row["odds"]:
            inv = [1 / x for x in odds]
            s = sum(inv)
            prob = [v / s * 100 for v in inv]
            row["vinstchans"] = [round(p, 1) for p in prob]
            row["marginal"] = round((s - 1) * 100, 1)
            row["exakt"] = correct_scores(*(p / 100 for p in prob), sport=sport)
            if row["streck"]:
                row["spelvarde"] = [round(prob[i] - streck[i], 1) for i in range(3)]
                fav = max(range(3), key=lambda i: streck[i])
                sk = 100 - prob[fav]
                row["skrall"] = {"folketsFavorit": "1X2"[fav], "procent": round(sk, 1), "niva": level(sk, 35, 55)}
                # bästa skrällval: icke-favorit med högst positivt spelvärde
                cands = [i for i in range(3) if i != fav and prob[i] - streck[i] > 0]
                if cands:
                    b = max(cands, key=lambda i: prob[i] - streck[i])
                    row["skrall"]["basta"] = {"tecken": "1X2"[b], "lag": [home, "oavgjort", away][b],
                                              "chans": round(prob[b], 1), "streck": round(streck[b], 1),
                                              "varde": round(prob[b] - streck[b], 1)}
        n = notes.get("football", {}).get(f"{product}-{d['drawNumber']}-{ev['eventNumber']}")
        row["analys"] = {"sv": (n or {}).get("sv"), "en": (n or {}).get("en"), "finns": bool(n)}
        matcher.append(row)
    return {
        "id": product, "namn": d.get("productName", product.capitalize()),
        "omgang": d["drawNumber"], "beskrivning": d.get("drawComment"),
        "spelstopp": d["regCloseTime"], "status": d.get("drawState"),
        "omsattning": num(d.get("currentNetSale")), "radpris": FOOT_PRICE,
        "streckUppdaterat": next((ev.get("svenskaFolket", {}) or {}).get("date") for ev in d.get("drawEvents", []) if ev.get("svenskaFolket")),
        "sport": sport, "matcher": matcher,
    }


def live_fields(m):
    """Status och resultat enligt Svenska Spel vid uppdateringen (inte sekund för sekund)."""
    out = {"lage": m.get("sportEventStatus")}
    res = {r.get("sportEventResultType"): r for r in (m.get("result") or [])}
    cur = res.get("Current") or res.get("Fulltime")
    if cur and cur.get("home") not in (None, "") and cur.get("away") not in (None, ""):
        out["resultat"] = [int(num(cur["home"]) or 0), int(num(cur["away"]) or 0)]
    per = [res[k] for k in ("Period1", "Period2", "Period3") if k in res]
    if len(per) == 3:  # hockey: ordinarie tid (1X2 på Powerplay gäller 60 min)
        out["ordinarie"] = [sum(int(num(r["home"]) or 0) for r in per), sum(int(num(r["away"]) or 0) for r in per)]
    return out


def senaste(key, endpoint, new, old_all, keep_h=30):
    """Behåll stängda omgångar (för Live-fliken) en stund efter att nästa omgång släppts."""
    t = now()
    cands = []
    prev = old_all.get(key)
    if prev and prev.get("omgang") and prev.get("matcher") and prev.get("omgang") != (new or {}).get("omgang"):
        cands.append(prev)
    cands += [x for x in (old_all.get("_senaste", {}).get(key) or []) if x.get("omgang") != (new or {}).get("omgang")]
    out, seen = [], set()
    for c in cands:
        if c["omgang"] in seen:
            continue
        seen.add(c["omgang"])
        last = max((parse(m["start"]) for m in c["matcher"] if m.get("start")), default=None)
        if not last or last < t - timedelta(hours=keep_h):
            continue
        try:
            dr = (get(f"https://api.spela.svenskaspel.se/draw/1/{endpoint}/draws/{c['omgang']}") or {}).get("draw") or {}
            byn = {ev["eventNumber"]: ev for ev in dr.get("drawEvents", [])}
        except Exception:
            byn = {}
        ms = []
        for m in c["matcher"]:
            r = {k: m.get(k) for k in ("nr", "matchId", "hemma", "borta", "liga", "land", "start", "status", "struken", "duell", "vinstchans", "streck", "resultat", "ordinarie", "lage")}
            ev = byn.get(m["nr"])
            if ev and ev.get("match"):
                r["status"] = ev["match"].get("status")
                r.update(live_fields(ev["match"]))
            ms.append(r)
        out.append({"id": key, "namn": c.get("namn"), "omgang": c["omgang"], "spelstopp": c.get("spelstopp"),
                    "status": dr.get("drawState") or c.get("status"), "sport": c.get("sport"), "radpris": c.get("radpris"), "matcher": ms})
    return out


# ---------------- Bomben ----------------
def bomben(max_draws=6):
    data = get(SS.format(p="bomben"))
    t = now()
    draws = sorted([d for d in data.get("draws", []) if d.get("drawState") == "Open" and parse(d["regCloseTime"]) > t],
                   key=lambda d: parse(d["regCloseTime"]))[:max_draws]
    if not draws:
        return {"id": "bomben", "namn": "Bomben", "status": "ingen", "omgangar": [],
                "meddelande": "Ingen öppen Bomben-omgång just nu."}
    out = []
    for d in draws:
        sport = "hockey" if (d.get("sport") or {}).get("id") == 7 else ("fotboll" if (d.get("sport") or {}).get("id") == 1 else "annan")
        matcher = []
        for ev in d.get("events", []):
            m = ev.get("match") or {}
            parts = {p["type"]: p for p in m.get("participants", [])}
            folk_h, folk_a = [], []
            for r in ev.get("svenskaFolket") or []:
                lbl = r["score"].split("-")[0]
                lbl = "10+" if lbl == "F" else lbl
                folk_h.append({"mal": lbl, "p": num(r.get("home")) or 0})
                folk_a.append({"mal": lbl, "p": num(r.get("away")) or 0})
            folk_top = None
            if folk_h and sum(x["p"] for x in folk_h) > 0:
                comb = [(h["p"] * a["p"] / 100, h["mal"], a["mal"]) for h in folk_h for a in folk_a]
                comb.sort(reverse=True)
                folk_top = [{"res": f"{h}–{a}", "p": round(p, 1)} for p, h, a in comb[:3]]
            exakt, kalla = None, None
            hit = ODDS_BY_MATCH.get(m.get("matchId"))
            if hit and sport in ("fotboll", "hockey"):
                od, kalla, sp = hit
                inv = [1 / x for x in od]
                s_ = sum(inv)
                exakt = correct_scores(*(v / s_ for v in inv), sport=sport)
                exakt["odds"] = od
                exakt["vinstchans"] = [round(v / s_ * 100, 1) for v in inv]
            matcher.append({
                "nr": ev.get("eventNumber"), "hemma": tname(parts.get("home")), "borta": tname(parts.get("away")),
                "liga": (m.get("league") or {}).get("name"), "start": m.get("matchStart"),
                "folketHemma": [x for x in folk_h if x["p"] > 0], "folketBorta": [x for x in folk_a if x["p"] > 0],
                "folketTopp": folk_top, "exakt": exakt, "oddsKalla": kalla,
            })
        out.append({
            "omgang": d["drawNumber"], "namn": d.get("description"), "tema": d.get("drawComment"),
            "sport": (d.get("sport") or {}).get("name"), "spelstopp": d["regCloseTime"],
            "omsattning": num(d.get("currentNetSales")), "matcher": matcher,
        })
    return {"id": "bomben", "namn": "Bomben", "status": "Open", "spelstopp": out[0]["spelstopp"],
            "omgang": out[0]["omgang"], "streckUppdaterat": None, "omgangar": out,
            "info": "Bomben: tippa exakt antal mål för varje lag. Svenska Spel visar inga odds för Bomben – "
                    "här visas folkets streck per lag och, när matchen finns med odds på Stryk/Europa/Topptipset/Powerplay, en modell från de oddsen."}


# ---------------- Trav ----------------
def next_game(bet):
    t = now()
    cands = []
    try:
        prod = get(f"{ATG}/products/{bet}")
        cands += [g["id"] for g in prod.get("upcoming", [])]
    except Exception:
        pass
    if not cands:
        for k in range(0, 10):
            day = (t + timedelta(days=k)).strftime("%Y-%m-%d")
            try:
                cal = get(f"{ATG}/calendar/day/{day}")
            except Exception:
                continue
            for g in cal.get("games", {}).get(bet, []):
                if g.get("status") in ("upcoming", "bettable", "ongoing"):
                    cands.append(g["id"])
            if cands:
                break
    for gid in cands:
        g = get(f"{ATG}/games/{gid}")
        st = parse(g["races"][0]["startTime"])
        if g.get("status") in ("upcoming", "bettable") and st > t - timedelta(minutes=5):
            return g
    return None


def horse_form(race_id, nr):
    try:
        x = get(f"{ATG}/races/{race_id}/start/{nr}", tries=2)
    except Exception:
        return None
    out = []
    for r in (x.get("horse", {}).get("results", {}) or {}).get("records", [])[:5]:
        p = str(r.get("place", "?"))
        if r.get("disqualified"): p = "d"
        elif r.get("galloped"): p += "g"
        out.append(p)
    return out


def trav(bet, notes, with_form=True):
    g = next_game(bet)
    if not g:
        return {"id": bet, "namn": bet, "status": "ingen",
                "meddelande": f"Nästa {bet}-omgång är inte publicerad än – visas så fort ATG släpper den."}
    year = str(now().year)
    forms = {}
    if with_form:
        jobs = [(r["id"], s["number"]) for r in g["races"] for s in r["starts"]]
        with cf.ThreadPoolExecutor(8) as ex:
            for j, f in zip(jobs, ex.map(lambda j: horse_form(*j), jobs)):
                forms[j] = f
    lopp = []
    for i, r in enumerate(g["races"], 1):
        starts = []
        for s in r["starts"]:
            h, pools = s.get("horse", {}), s.get("pools", {}) or {}
            odds = (pools.get("vinnare") or {}).get("odds")
            st = (pools.get(bet) or {}).get("betDistribution")
            rec = (h.get("record") or {}).get("time") or {}
            y = ((h.get("statistics") or {}).get("years") or {}).get(year) or {}
            starts.append({
                "nr": s["number"], "namn": h.get("name"),
                "kusk": f"{s.get('driver', {}).get('firstName', '')} {s.get('driver', {}).get('lastName', '')}".strip(),
                "tranare": f"{h.get('trainer', {}).get('firstName', '')} {h.get('trainer', {}).get('lastName', '')}".strip(),
                "spar": s.get("postPosition"), "distans": s.get("distance"),
                "struken": bool(s.get("scratched")),
                "odds": round(odds / 100, 2) if odds else None,
                "streck": round(st / 100, 1) if st is not None else None,
                "rekord": f"{rec.get('minutes')}.{rec.get('seconds'):02d},{rec.get('tenths')}" if rec.get("seconds") is not None else None,
                "aret": {"starter": y.get("starts"), "segrar": (y.get("placement") or {}).get("1")},
                "form": forms.get((r["id"], s["number"])),
            })
        live = [x for x in starts if not x["struken"] and x["odds"]]
        if live:
            tot = sum(1 / x["odds"] for x in live)
            for x in live:
                x["vinstchans"] = round((1 / x["odds"]) / tot * 100, 1)
                if x["streck"] is not None:
                    x["spelvarde"] = round(x["vinstchans"] - x["streck"], 1)
        skrall = None
        strecked = [x for x in starts if not x["struken"] and x["streck"] is not None]
        if strecked and live:
            fav = max(strecked, key=lambda x: x["streck"])
            if fav.get("vinstchans") is not None:
                sk = 100 - fav["vinstchans"]
                skrall = {"folketsFavorit": fav["nr"], "procent": round(sk, 1), "niva": level(sk, 45, 65)}
                cands = [x for x in live if x["nr"] != fav["nr"] and x.get("spelvarde") is not None and x["spelvarde"] > 0 and x["vinstchans"] >= 3]
                if cands:
                    b = max(cands, key=lambda x: x["spelvarde"])
                    skrall["basta"] = {"nr": b["nr"], "namn": b["namn"], "chans": b["vinstchans"],
                                       "streck": b["streck"], "varde": b["spelvarde"]}
        n = notes.get("trav", {}).get(f"{g['id']}-{i}")
        lopp.append({
            "avd": i, "id": r["id"], "namn": r.get("name"), "bana": r.get("track", {}).get("name"),
            "start": iso(parse(r["startTime"])), "distans": r.get("distance"), "startmetod": r.get("startMethod"),
            "skrall": skrall, "analys": {"sv": (n or {}).get("sv"), "en": (n or {}).get("en"), "finns": bool(n)},
            "starter": starts,
        })
    jackpot = ((g.get("pools") or {}).get(bet) or {})
    return {
        "id": bet, "namn": bet, "omgang": g["id"], "status": g.get("status"),
        "banor": sorted({l["bana"] for l in lopp}), "spelstopp": lopp[0]["start"],
        "radpris": TRAV_PRICE[bet], "oddsFinns": any(x.get("odds") for l in lopp for x in l["starter"]),
        "streckFinns": any(x.get("streck") is not None for l in lopp for x in l["starter"]),
        "omsattning": (jackpot.get("turnover") / 100) if jackpot.get("turnover") else None,
        "lopp": lopp,
    }


def main():
    with_form = "--no-form" not in sys.argv
    try:
        notes = json.load(open(os.path.join(HERE, "notes.json"), encoding="utf-8"))
    except FileNotFoundError:
        notes = {}
    out_path = os.path.join(HERE, "data.json")
    try:
        old = json.load(open(out_path, encoding="utf-8"))
    except Exception:
        old = {}
    res, errors = {}, []
    for key, fn in (("stryktipset", lambda: football("stryktipset", notes)),
                    ("europatipset", lambda: football("europatipset", notes)),
                    ("topptipset", lambda: football("topptipset", notes, endpoint="topptipsetfamily", product_id=25)),
                    ("powerplay", lambda: football("powerplay", notes, "hockey")),
                    ("bomben", lambda: bomben()),
                    ("V75", lambda: trav("V75", notes, with_form)),
                    ("V86", lambda: trav("V86", notes, with_form))):
        try:
            res[key] = fn()
        except Exception as e:
            errors.append(f"{key}: {e}")
            prev = (old.get("fotboll", {}) | old.get("hockey", {}) | old.get("trav", {}) | {"bomben": old.get("bomben")}).get(key)
            # behåll bara gammal data om dess spelstopp inte har passerat
            if prev and prev.get("spelstopp") and parse(prev["spelstopp"]) > now():
                res[key] = prev
            else:
                res[key] = {"id": key, "namn": key, "status": "fel", "meddelande": "Kunde inte hämta just nu – försöker igen vid nästa uppdatering."}
    old_all = old.get("fotboll", {}) | old.get("hockey", {})
    old_all["_senaste"] = (old.get("live") or {}).get("senaste") or {}
    sen = {}
    for key, ep in (("stryktipset", "stryktipset"), ("europatipset", "europatipset"), ("topptipset", "topptipset"), ("powerplay", "powerplay")):
        try:
            sen[key] = senaste(key, ep, res.get(key), old_all)
        except Exception as e:
            errors.append(f"live {key}: {e}")
            sen[key] = []
    data = {
        "uppdaterad": iso(now()),
        "kallor": {"fotboll": "Svenska Spel (publikt API)", "hockey": "Svenska Spel (publikt API)", "trav": "ATG (publikt API)"},
        "fotboll": {"stryktipset": res["stryktipset"], "europatipset": res["europatipset"], "topptipset": res["topptipset"]},
        "hockey": {"powerplay": res["powerplay"]},
        "bomben": res["bomben"],
        "trav": {"V75": res["V75"], "V86": res["V86"]},
        "live": {"senaste": sen, "kalla": "Svenska Spel vid uppdateringen; i appen hämtas live från ESPN var 20:e sekund"},
        "lankar": notes.get("links", {}),
        "fel": errors,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)
    print("data.json skriven", data["uppdaterad"], "fel:", errors or "inga")
    for k, v in res.items():
        print(f"  {k}: omgång {v.get('omgang')} spelstopp {v.get('spelstopp')} status {v.get('status')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
