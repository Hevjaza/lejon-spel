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


def get(url, tries=3):
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


def fit_lambdas(p1, px, p2):
    """Minsta kvadrat-anpassning av hemma/borta-målförväntan till 1X2-sannolikheterna."""
    best = None
    for i in range(10, 400, 5):          # grovt rutnät 0.10–4.00
        for j in range(10, 400, 5):
            lh, la = i / 100, j / 100
            h, d, a = outcome_probs(lh, la, 9)
            e = (h - p1) ** 2 + (d - px) ** 2 + (a - p2) ** 2
            if best is None or e < best[0]:
                best = (e, lh, la)
    _, bh, ba = best
    for i in range(-5, 6):               # finjustering ±0.05
        for j in range(-5, 6):
            lh, la = max(0.05, bh + i / 100), max(0.05, ba + j / 100)
            h, d, a = outcome_probs(lh, la, 10)
            e = (h - p1) ** 2 + (d - px) ** 2 + (a - p2) ** 2
            if e < best[0]:
                best = (e, lh, la)
    return best[1], best[2]


def correct_scores(p1, px, p2, top=3):
    lh, la = fit_lambdas(p1, px, p2)
    grid = [(pois(i, lh) * pois(j, la), i, j) for i in range(8) for j in range(8)]
    grid.sort(reverse=True)
    return {
        "modell": "Modell från odds (Poisson anpassad till 1X2-oddsen)",
        "xgHemma": round(lh, 2), "xgBorta": round(la, 2),
        "topp": [{"res": f"{i}–{j}", "p": round(p * 100, 1)} for p, i, j in grid[:top]],
    }


# ---------------- Fotboll ----------------
def football(product, notes):
    data = get(SS.format(p=product))
    t = now()
    draws = [d for d in data.get("draws", []) if parse(d["regCloseTime"]) > t]
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
        def tname(p):
            p = p or {}
            n = p.get("name") or ""
            return n if n and len(n) <= 16 else (p.get("mediumName") or n or None)
        home, away = tname(parts.get("home")), tname(parts.get("away"))
        if not home:
            home, _, away = ev.get("eventDescription", "").partition(" - ")
        o = ev.get("odds") or {}
        odds = [num(o.get("one")), num(o.get("x")), num(o.get("two"))]
        sf = ev.get("svenskaFolket") or {}
        streck = [num(sf.get("one")), num(sf.get("x")), num(sf.get("two"))]
        row = {
            "nr": ev["eventNumber"], "hemma": home, "borta": away,
            "liga": (m.get("league") or {}).get("name"),
            "land": ((m.get("league") or {}).get("country") or {}).get("name"),
            "start": m.get("matchStart"), "status": m.get("status"),
            "struken": bool(ev.get("cancelled")),
            "odds": odds if all(odds) else None, "streck": streck if all(x is not None for x in streck) else None,
        }
        if row["odds"]:
            inv = [1 / x for x in odds]
            s = sum(inv)
            prob = [v / s * 100 for v in inv]
            row["vinstchans"] = [round(p, 1) for p in prob]
            row["marginal"] = round((s - 1) * 100, 1)
            row["exakt"] = correct_scores(*(p / 100 for p in prob))
            if row["streck"]:
                row["spelvarde"] = [round(prob[i] - streck[i], 1) for i in range(3)]
                fav = max(range(3), key=lambda i: streck[i])
                sk = 100 - prob[fav]
                row["skrall"] = {"folketsFavorit": "1X2"[fav], "procent": round(sk, 1), "niva": level(sk, 35, 55)}
        n = notes.get("football", {}).get(f"{product}-{d['drawNumber']}-{ev['eventNumber']}")
        row["analys"] = {"sv": (n or {}).get("sv"), "en": (n or {}).get("en"), "finns": bool(n)}
        matcher.append(row)
    return {
        "id": product, "namn": d.get("productName", product.capitalize()),
        "omgang": d["drawNumber"], "beskrivning": d.get("drawComment"),
        "spelstopp": d["regCloseTime"], "status": d.get("drawState"),
        "omsattning": num(d.get("currentNetSale")), "radpris": FOOT_PRICE,
        "streckUppdaterat": next((ev.get("svenskaFolket", {}) or {}).get("date") for ev in d.get("drawEvents", []) if ev.get("svenskaFolket")),
        "matcher": matcher,
    }


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
                    ("V75", lambda: trav("V75", notes, with_form)),
                    ("V86", lambda: trav("V86", notes, with_form))):
        try:
            res[key] = fn()
        except Exception as e:
            errors.append(f"{key}: {e}")
            prev = (old.get("fotboll", {}) | old.get("trav", {})).get(key)
            # behåll bara gammal data om dess spelstopp inte har passerat
            if prev and prev.get("spelstopp") and parse(prev["spelstopp"]) > now():
                res[key] = prev
            else:
                res[key] = {"id": key, "namn": key, "status": "fel", "meddelande": "Kunde inte hämta just nu – försöker igen vid nästa uppdatering."}
    data = {
        "uppdaterad": iso(now()),
        "kallor": {"fotboll": "Svenska Spel (publikt API)", "trav": "ATG (publikt API)"},
        "fotboll": {"stryktipset": res["stryktipset"], "europatipset": res["europatipset"]},
        "trav": {"V75": res["V75"], "V86": res["V86"]},
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
