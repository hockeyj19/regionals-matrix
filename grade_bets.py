"""
Auto-grade pending bets and archive results.

Sources, by the event's stored source_url:
  gidstats.com  - the primary source (July 2026 onward). The event page gives
                  the card; each bout page carries the result strip
                  ("1:05 - Round 3 - KO/TKO Ground & Pound"). Winner
                  attribution on gidstats is styled rather than written, so
                  it's recovered in layers:
                    1) a win/loss marker in the bout page markup, taken only
                       when it sits on exactly one fighter's side;
                    2) draws / no contests read straight from the method;
                    3) over/unders never need a winner - they grade off the
                       finish time alone;
                    4) anything still unattributed is flagged for manual
                       settling WITH the parsed method/round/time in the note,
                       so settling is one tap. Nothing is ever guessed.
  onefc.com     - unchanged ONE Championship parser.
  sherdog.com   - legacy URLs from before the source switch. Sherdog now sits
                  behind a Cloudflare JS challenge no script can pass; the
                  first blocked fetch of a run trips a switch and every
                  remaining Sherdog bet is annotated for manual settling once.

Grading conventions (standard book rules):
  - KO/TKO bucket includes DQ; Decision includes technical decisions.
  - Round props lose if the fight goes to a decision.
  - A fight ending exactly on an over/under mark is flagged, not guessed.
  - No contest = push; a draw pushes moneylines and loses fighter-win props.

Run:  python grade_bets.py                     -> grade everything gradeable
      python grade_bets.py <event url>         -> DRY RUN: print parsed results
      python grade_bets.py <gidstats bout url> -> DRY RUN: one bout's result
"""

import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
import http_client
from bs4 import BeautifulSoup
from scrape_gidstats import parse_event_page

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

ROUND_SECONDS = 300  # 5-minute rounds
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
METHOD_RE = re.compile(
    r"(KO|TKO|Submission|Decision|Draw|No Contest|NC|DQ|Disqualification|"
    r"Retirement|Forfeit|Technical)", re.I)

# Sherdog is behind a Cloudflare JS challenge; once one fetch is blocked in a
# run, stop hammering it and route those bets to manual settling.
_SHERDOG_BLOCKED = False
SHERDOG_BLOCKED_NOTE = ("Sherdog now blocks automated access (Cloudflare) - "
                        "settle manually")


def clean(t):
    return re.sub(r"\s+", " ", t or "").strip()


def _nn(n):
    """Accent-stripped, lowercased name (kept local so dry runs don't need
    Supabase credentials the way importing db would)."""
    s = unicodedata.normalize("NFD", n or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def fighter_from_link(a):
    href = a.get("href", "")
    m = re.search(r"/fighter/([A-Za-z'\-\.]+?)-(\d+)$", href)
    if m:
        return clean(m.group(1).replace("-", " ")), m.group(2)
    return clean(a.get_text()), None


def norm_result(s):
    s = clean(s).lower()
    if "no contest" in s or s == "nc":
        return "nc"
    if "win" in s:
        return "win"
    if "loss" in s or "lose" in s:
        return "loss"
    if "draw" in s:
        return "draw"
    return None


def method_bucket(method):
    """Book-style buckets. DQ counts as KO/TKO; technical decision as decision."""
    s = (method or "").lower()
    if "no contest" in s or re.search(r"\bnc\b", s):
        return "nc"
    if "draw" in s:
        return "draw"
    if "submission" in s:
        return "submission"
    if "decision" in s:
        return "decision"
    if "ko" in s or "dq" in s or "disqualification" in s:
        return "ko_tko"
    return "unknown"


def time_to_seconds(t):
    m = re.match(r"(\d{1,2}):(\d{2})", t or "")
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def elapsed_seconds(rnd, tm, round_seconds=ROUND_SECONDS):
    """Total fight time in seconds from (round, time-in-round)."""
    try:
        r = int(rnd)
    except (TypeError, ValueError):
        return None
    secs = time_to_seconds(tm)
    if secs is None:
        return None
    return (r - 1) * round_seconds + secs


# --------------------------------------------------------------- Sherdog ---

def result_marker(node):
    """win/loss/draw/nc from a hero fighter block, or None if not fought yet."""
    if node is None:
        return None
    span = node.select_one("[class*='final_result']")
    if span:
        return norm_result(span.get_text())
    txt = clean(node.get_text(" ")).lower()
    m = re.search(r"\(win-loss-draw\)\s*(win|loss|draw|no contest|nc)\b", txt)
    return norm_result(m.group(1)) if m else None


def result_cell(td):
    """win/loss/draw/nc from an undercard fighter cell, or None."""
    if td is None:
        return None
    span = td.select_one("[class*='final_result']")
    if span:
        return norm_result(span.get_text())
    txt = clean(td.get_text(" ")).lower()
    m = re.search(r"\b(win|loss|draw|no contest|nc)\s*$", txt)
    return norm_result(m.group(1)) if m else None


def make_bout(f1, f2, method, rnd, tm):
    return {
        "names": {f1[1]: f1[0], f2[1]: f2[0]},
        "results": {f1[1]: f1[2], f2[1]: f2[2]},
        "method": method,
        "round": rnd,
        "time": tm,
    }


def parse_event_results(html):
    """All completed bouts on a Sherdog event page. Bouts without results
    (upcoming, or page not updated yet) are omitted."""
    soup = BeautifulSoup(html, "lxml")
    bouts = []

    # --- main event: hero fighter blocks + the Method/Referee/Round/Time strip
    heroes = []
    for div in soup.select(".fighter"):
        a = div.select_one("a[href*='/fighter/']")
        if not a:
            continue
        name, fid = fighter_from_link(a)
        if not name or any(h[1] == fid and h[0] == name for h in heroes):
            continue
        heroes.append((name, fid, result_marker(div)))
    heroes = heroes[:2]

    me_method = me_round = me_time = None
    for tbl in soup.find_all("table"):
        text = clean(tbl.get_text(" "))
        m = re.search(
            r"Method\s+(.*?)\s+Referee\s+.*?Round\s+(\d+)\s+Time\s+(\d{1,2}:\d{2})",
            text)
        if m:
            me_method, me_round, me_time = clean(m.group(1)), m.group(2), m.group(3)
            break

    if len(heroes) == 2 and (heroes[0][2] or heroes[1][2]):
        bouts.append(make_bout(heroes[0], heroes[1], me_method, me_round, me_time))

    # --- undercard result rows: [..., method+referee, round, time]
    for row in soup.select("table tr"):
        links = row.select("a[href*='/fighter/']")
        if len(links) < 2:
            continue
        pairs = []
        for a in links:
            nm, fid = fighter_from_link(a)
            if not nm or any(nm == p[0] for p in pairs):
                continue
            pairs.append((nm, fid, result_cell(a.find_parent("td"))))
        if len(pairs) < 2:
            continue
        f1, f2 = pairs[0], pairs[1]
        if f1[2] is None and f2[2] is None:
            continue  # no result yet

        tds = row.find_all("td")
        rm = rr = rt = None
        for td in reversed(tds):
            txt = clean(td.get_text(" "))
            if rt is None:
                if TIME_RE.fullmatch(txt):
                    rt = txt
                continue
            if rr is None:
                if re.fullmatch(r"[1-5]", txt):
                    rr = txt
                continue
            # first cell before round/time: the method (strip the referee link)
            for ref in td.select("a[href*='/referee/']"):
                ref.extract()
            cand = clean(td.get_text(" "))
            if cand and METHOD_RE.search(cand):
                rm = cand
            break
        bouts.append(make_bout(f1, f2, rm, rr, rt))

    return bouts


# --- ONE Championship (onefc.com) ---
# On completed events the winner's athlete card carries a "WIN" marker plus
# the method and round, e.g. "WIN Knockout (R2)". No finish time is published,
# and round lengths differ by discipline, so over/unders are flagged manual.
ONE_METHOD_RE = re.compile(
    r"(Knockout|TKO|KO|Submission|Unanimous Decision|Split Decision|"
    r"Majority Decision|Technical Decision|Decision|Draw|No Contest|"
    r"Disqualification|DQ)\s*\(R(\d)\)", re.I)


def _anchor_blob(a):
    """Anchor text plus every child image's alt text, flattened."""
    parts = [a.get_text(" ")]
    for img in a.find_all("img"):
        parts.append(img.get("alt") or "")
    return clean(" ".join(parts))


def parse_onefc_results(html):
    """Completed bouts on a onefc.com event page, keyed by athlete slug."""
    soup = BeautifulSoup(html, "lxml")

    # collect result markers from every athlete anchor on the page
    info = {}
    for a in soup.select("a[href*='/athletes/']"):
        m = re.search(r"/athletes/([a-z0-9\-]+)", a.get("href", ""))
        if not m:
            continue
        slug = m.group(1)
        blob = _anchor_blob(a)
        d = info.setdefault(slug, {"win": False, "draw": False, "nc": False,
                                   "method": None, "round": None})
        if re.search(r"\bWIN\b", blob):
            d["win"] = True
        if re.search(r"\bDRAW\b", blob, re.I):
            d["draw"] = True
        if re.search(r"\bNo Contest\b", blob, re.I):
            d["nc"] = True
        mm = ONE_METHOD_RE.search(blob)
        if mm and d["method"] is None:
            d["method"] = clean(mm.group(1))
            d["round"] = mm.group(2)

    # pair bouts using the same name tables the card scraper uses
    bouts = []
    seen = set()
    for tbl in soup.find_all("table"):
        pairs = []
        for a in tbl.select("a[href*='/athletes/']"):
            m = re.search(r"/athletes/([a-z0-9\-]+)", a.get("href", ""))
            txt = clean(a.get_text())
            if not m or not txt or re.search(r"\d", txt):
                continue
            slug = m.group(1)
            if not any(slug == p[1] for p in pairs):
                pairs.append((txt, slug))
        if len(pairs) < 2:
            continue
        (n1, s1), (n2, s2) = pairs[0], pairs[1]
        key = tuple(sorted((s1, s2)))
        if key in seen:
            continue
        seen.add(key)
        d1 = info.get(s1, {})
        d2 = info.get(s2, {})
        r1 = r2 = None
        if d1.get("nc") or d2.get("nc"):
            r1 = r2 = "nc"
        elif d1.get("draw") or d2.get("draw"):
            r1 = r2 = "draw"
        elif d1.get("win") and not d2.get("win"):
            r1, r2 = "win", "loss"
        elif d2.get("win") and not d1.get("win"):
            r1, r2 = "loss", "win"
        if r1 is None and r2 is None:
            continue  # not fought yet
        bouts.append({
            "names": {s1: n1, s2: n2},
            "results": {s1: r1, s2: r2},
            "method": d1.get("method") or d2.get("method"),
            "round": d1.get("round") or d2.get("round"),
            "time": None,
            "round_seconds": None,  # varies by discipline (3-min vs 5-min rounds)
        })
    return bouts


# --------------------------------------------------------------- GIDStats ---

GID_STRIP_RE = re.compile(
    r"(\d{1,2}:\d{2})\s*[\u2022\u00b7\-]\s*Round\s*([1-5])\s*[\u2022\u00b7\-]\s*(.+)",
    re.I)

_WIN_TOKENS = {"win", "winner", "won", "victory"}
_LOSS_TOKENS = {"loss", "lose", "loser", "lost", "defeat", "defeated"}


def _class_tokens(el):
    """Class attribute broken into comparable word tokens (splits on -/_)."""
    out = set()
    for cls in (el.get("class") or []):
        for part in re.split(r"[-_\s]+", cls.lower()):
            if part:
                out.add(part)
    return out


def _fighter_block(soup, anchor, other_slug):
    """The largest ancestor of this fighter's anchor that does NOT contain
    the opponent's anchor - i.e. this fighter's own column."""
    node = anchor
    while node.parent is not None and getattr(node.parent, "name", None):
        parent = node.parent
        if parent.select_one(f"a[href*='/fighters/{other_slug}.html']"):
            break
        node = parent
        if node.name in ("body", "html"):
            break
    return node


def _side_signals(block):
    """(win_hit, loss_hit) from class tokens and lone text badges inside one
    fighter's column. A column showing BOTH labels (hidden-state spans) says
    nothing, so it contributes nothing."""
    win = loss = False
    els = [block] + block.find_all(True)
    for el in els:
        toks = _class_tokens(el)
        if toks & _WIN_TOKENS:
            win = True
        if toks & _LOSS_TOKENS:
            loss = True
    # text badges: an element whose entire text is just Win / Loss
    tw = tl = False
    for el in els:
        txt = clean(el.get_text(" ")).lower().rstrip("!")
        if txt in ("win", "winner"):
            tw = True
        elif txt in ("loss", "lose", "loser"):
            tl = True
    if tw and not tl:
        win = True
    if tl and not tw:
        loss = True
    return win, loss


def _sniff_winner(soup, s1, s2):
    """Winner slug when the markup marks exactly one side - else None.
    Conservative on purpose: any ambiguity means no attribution."""
    a1 = soup.select_one(f"a[href*='/fighters/{s1}.html']")
    a2 = soup.select_one(f"a[href*='/fighters/{s2}.html']")
    if a1 is None or a2 is None:
        return None
    b1 = _fighter_block(soup, a1, s2)
    b2 = _fighter_block(soup, a2, s1)
    w1, l1 = _side_signals(b1)
    w2, l2 = _side_signals(b2)
    if w1 and not w2 and not l1:
        return s1
    if w2 and not w1 and not l2:
        return s2
    if l1 and not l2 and not w1 and not w2:
        return s2
    if l2 and not l1 and not w1 and not w2:
        return s1
    return None


def parse_gid_bout_page(html):
    """One gidstats bout page -> {method, round, time, fighters, winner_slug}.
    method/round/time come from the result strip; winner_slug only when the
    markup unambiguously marks one side."""
    soup = BeautifulSoup(html, "lxml")

    fighters = []
    for fa in soup.select("a[href*='/fighters/']"):
        m = re.search(r"/fighters/([a-z0-9_\-\.]+)\.html", fa.get("href", ""), re.I)
        if not m:
            continue
        slug = m.group(1).lower()
        if any(slug == s for _, s in fighters):
            continue
        name = clean(fa.get("title") or "") or clean(fa.get_text(" "))
        fighters.append((name, slug))
        if len(fighters) == 2:
            break

    # The result strip is an anchor back to the event page whose text reads
    # "<event> 1:05 . Round 3 . KO/TKO Ground & Pound" - parse inside the
    # anchor so the method can't bleed into surrounding page text.
    method = rnd = tm = None
    for a in soup.select("a[href*='/events/']"):
        m = GID_STRIP_RE.search(clean(a.get_text(" ")))
        if m:
            tm, rnd, method = m.group(1), m.group(2), clean(m.group(3))
            break
    if method is None:
        m = GID_STRIP_RE.search(clean(soup.get_text(" ")))
        if m:
            tm, rnd = m.group(1), m.group(2)
            raw = m.group(3)
            for nm, _s in fighters:          # cut before trailing page content
                if nm:
                    raw = raw.split(nm)[0]
            raw = re.split(r"\b\d+\s*Wins?\b|Round-by-round|Main Card|Prelims"
                           r"|Other Bouts|Share", raw, flags=re.I)[0]
            method = clean(raw)

    winner = None
    if method and len(fighters) == 2:
        winner = _sniff_winner(soup, fighters[0][1], fighters[1][1])

    return {"fighters": fighters, "method": method, "round": rnd,
            "time": tm, "winner_slug": winner}


def fetch_gid_event_results(event_url, cache):
    """Completed bouts for a gidstats event: the event page supplies the card
    (bout URLs, names, round format); each bout page supplies the result.
    Bouts whose result strip hasn't been posted yet are omitted."""
    try:
        resp = http_client.get(event_url, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  ! Could not fetch event page {event_url}: {e}")
        return None
    card = parse_event_page(resp.text, event_url)
    if not card["bouts"]:
        return []

    bouts = []
    for b in card["bouts"]:
        burl = b["bout_url"]
        if burl in cache:
            parsed = cache[burl]
        else:
            time.sleep(1.5)
            try:
                r = http_client.get(burl, timeout=30)
                r.raise_for_status()
                parsed = parse_gid_bout_page(r.text)
            except Exception as e:
                print(f"  ! Could not fetch bout {burl}: {e}")
                parsed = None
            cache[burl] = parsed
        if not parsed or not parsed["method"]:
            continue  # not fought yet, or result not posted

        s1, s2 = b["f1_slug"], b["f2_slug"]
        n1, n2 = b["f1"], b["f2"]
        bucket = method_bucket(parsed["method"])
        if bucket in ("nc", "draw"):
            r1 = r2 = bucket
        elif parsed["winner_slug"] == s1:
            r1, r2 = "win", "loss"
        elif parsed["winner_slug"] == s2:
            r1, r2 = "loss", "win"
        else:
            r1 = r2 = None  # result posted, winner not machine-readable

        rounds = b.get("rounds")
        bouts.append({
            "names": {s1: n1, s2: n2},
            "norm_names": {_nn(n1): s1, _nn(n2): s2},
            "results": {s1: r1, s2: r2},
            "method": parsed["method"],
            "round": parsed["round"],
            "time": parsed["time"],
            "round_seconds": rounds[1] * 60 if rounds else ROUND_SECONDS,
            "attributed": r1 is not None,
        })
    return bouts


# --------------------------------------------------------------- grading ---

def describe(bout):
    winner = next((f for f, r in bout["results"].items() if r == "win"), None)
    loser = next((f for f, r in bout["results"].items() if r == "loss"), None)
    meth = bout["method"] or "unknown method"
    tail = ""
    if bout["round"] and bout["time"]:
        tail = f"R{bout['round']} {bout['time']}"
    if winner is not None and loser is not None:
        return clean(f"{bout['names'][winner]} def. {bout['names'][loser]} by {meth} {tail}")
    names = list(bout["names"].values())
    return clean(f"{names[0]} vs {names[1]} - {meth} {tail}")


def grade_bet(bet, bout):
    """Returns (result, note) where result is win/loss/push,
    (None, note) to flag for manual settling, or (None, None) to leave alone."""
    fid = bet.get("fighter_id")
    my = bout["results"].get(fid)
    bucket = method_bucket(bout["method"])
    desc = describe(bout)
    bt = bet.get("bet_type")

    if bucket == "nc" or my == "nc":
        return "push", f"Auto: no contest - {desc}"

    if bt == "moneyline":
        if my == "win":
            return "win", f"Auto: {desc}"
        if my == "loss":
            return "loss", f"Auto: {desc}"
        if my == "draw" or bucket == "draw":
            return "push", f"Auto: draw - {desc}"
        return None, None  # no result for this fighter yet

    if bt in ("over", "under"):
        rs = bout.get("round_seconds", ROUND_SECONDS)
        if rs is None:
            return None, "Auto: round length varies by discipline here - settle over/unders manually"
        try:
            line = float(bet.get("ou_line") or 0)
        except (TypeError, ValueError):
            line = 0
        el = elapsed_seconds(bout["round"], bout["time"], rs)
        if el is None or line <= 0:
            return None, "Auto: could not read the finish time - settle manually"
        threshold = int(line) * rs + rs // 2
        if el == threshold:
            return None, f"Auto: ended exactly on the {line} mark - check your book's rules ({desc})"
        went_over = el > threshold
        won = (bt == "over") == went_over
        return ("win" if won else "loss"), f"Auto: {desc}"

    # fighter-win props (method / round / method_round)
    if my == "draw" or bucket == "draw":
        return "loss", f"Auto: draw - {desc}"
    if my == "loss":
        return "loss", f"Auto: {desc}"
    if my != "win":
        return None, None  # no result for this fighter yet
    if bucket == "unknown":
        return None, f"Auto: could not read the method - settle manually ({desc})"

    if bt == "method":
        ok = bucket == bet.get("prop_method")
        return ("win" if ok else "loss"), f"Auto: {desc}"
    if bt == "round":
        ok = bucket != "decision" and str(bout["round"]) == str(bet.get("prop_round"))
        return ("win" if ok else "loss"), f"Auto: {desc}"
    if bt == "method_round":
        ok = (bucket == bet.get("prop_method") and bucket != "decision"
              and str(bout["round"]) == str(bet.get("prop_round")))
        return ("win" if ok else "loss"), f"Auto: {desc}"
    return None, None


def _fetch_results(url, cache):
    """Fetch and parse a results page once per run (shared cache)."""
    global _SHERDOG_BLOCKED
    if url in cache:
        return cache[url]

    if "gidstats.com" in url:
        cache[url] = fetch_gid_event_results(url, cache)
        return cache[url]

    if "sherdog.com" in url and _SHERDOG_BLOCKED:
        cache[url] = None
        return None

    parse = parse_onefc_results if "onefc.com" in url else parse_event_results
    try:
        resp = http_client.get(url, timeout=30)
        resp.raise_for_status()
        cache[url] = parse(resp.text)
    except Exception as e:
        if "sherdog.com" in url:
            _SHERDOG_BLOCKED = True
            print(f"  ! Sherdog is blocking automated access ({e}) - "
                  f"skipping remaining Sherdog pages this run.")
        else:
            print(f"  ! Could not fetch results {url}: {e}")
        cache[url] = None
    time.sleep(2)
    return cache[url]


def _bet_fighter_name(bet):
    """The picked fighter's name from a structured selection."""
    return (bet.get("selection") or "").split(" by ")[0].split(" in ")[0].strip()


def _bout_key_for(bout, fid, name):
    """The key inside bout['results'] that belongs to this fighter: by ID
    when the namespaces line up, otherwise by normalized name (gidstats fights
    reuse legacy Sherdog IDs where known, so names are the bridge)."""
    if fid and fid in bout["results"]:
        return fid
    nn = _nn(name)
    if nn and nn in bout.get("norm_names", {}):
        return bout["norm_names"][nn]
    return None


def _match_bout(bouts, f1_id, f2_id, f1_name=None, f2_name=None):
    if not bouts:
        return None
    for b in bouts:
        if (f1_id and f1_id in b["results"]) or (f2_id and f2_id in b["results"]):
            return b
        nn = b.get("norm_names", {})
        if nn and (_nn(f1_name) in nn or _nn(f2_name) in nn):
            return b
    return None


def build_review_row(user_id, event, fight, bout):
    """Denormalized archive row: the matchup plus the outcome when available."""
    row = {
        "user_id": user_id,
        "fight_id": fight["id"],
        "org": event.get("org"),
        "event_name": event.get("event_name"),
        "event_date": event.get("event_date"),
        "source_url": event.get("source_url"),
        "fighter1_name": fight.get("fighter1_name"),
        "fighter2_name": fight.get("fighter2_name"),
        "fighter1_id": fight.get("fighter1_id"),
        "fighter2_id": fight.get("fighter2_id"),
        "weight_class": fight.get("weight_class"),
        "price1": None,
        "price2": None,
        "matrix": None,
        "winner_name": None,
        "f1_result": None,
        "method": None,
        "result_round": None,
        "result_time": None,
    }
    if bout:
        row["method"] = bout.get("method")
        row["result_round"] = bout.get("round")
        row["result_time"] = bout.get("time")
        res = bout.get("results", {})
        k1 = _bout_key_for(bout, fight.get("fighter1_id"), fight.get("fighter1_name"))
        row["f1_result"] = res.get(k1) if k1 else None
        winner = next((fid for fid, r in res.items() if r == "win"), None)
        if winner is not None:
            row["winner_name"] = bout["names"].get(winner)
    return row


def archive_past_results(cache=None):
    """Before past events are deleted, snapshot every fight the user engaged
    with (prices or matrix cells) into user_fight_review, outcome attached.
    Also backfills results onto earlier rows once slow pages update."""
    from db import (get_past_events, get_fights_for_event,
                    get_user_prices_for_fights, get_matrix_for_fights,
                    upsert_review_rows, backfill_review_targets,
                    update_review_result)
    if cache is None:
        cache = {}

    total = 0
    for ev in get_past_events():
        fights = get_fights_for_event(ev["id"])
        if not fights:
            continue
        ids = [f["id"] for f in fights]
        prices = get_user_prices_for_fights(ids)
        matrices = get_matrix_for_fights(ids)
        engaged = {}
        for (u, fid) in list(prices.keys()) + list(matrices.keys()):
            engaged.setdefault(u, set()).add(fid)
        if not engaged:
            continue
        url = ev.get("source_url") or ""
        bouts = None
        if "gidstats.com" in url or "sherdog.com" in url or "onefc.com" in url:
            bouts = _fetch_results(url, cache)
        fmap = {f["id"]: f for f in fights}
        rows = []
        for u, fset in engaged.items():
            for fid in fset:
                f = fmap.get(fid)
                if not f:
                    continue
                r = build_review_row(
                    u, ev, f,
                    _match_bout(bouts, f.get("fighter1_id"), f.get("fighter2_id"),
                                f.get("fighter1_name"), f.get("fighter2_name")))
                p = prices.get((u, fid))
                if p:
                    r["price1"], r["price2"] = p.get("price1"), p.get("price2")
                m = matrices.get((u, fid))
                if m:
                    r["matrix"] = m
                rows.append(r)
        if rows:
            upsert_review_rows(rows)
            total += len(rows)
            print(f"  Archived {len(rows)} fight(s) from {ev.get('event_name')}")

    # results that were not posted yet when we archived
    filled = 0
    for url, targets in backfill_review_targets().items():
        bouts = _fetch_results(url, cache)
        if not bouts:
            continue
        for t in targets:
            b = _match_bout(bouts, t.get("fighter1_id"), t.get("fighter2_id"),
                            t.get("fighter1_name"), t.get("fighter2_name"))
            if not b:
                continue
            res = b.get("results", {})
            k1 = _bout_key_for(b, t.get("fighter1_id"), t.get("fighter1_name"))
            f1r = res.get(k1) if k1 else None
            if not f1r:
                continue
            winner = next((fid for fid, r in res.items() if r == "win"), None)
            update_review_result(t["id"], {
                "f1_result": f1r,
                "winner_name": b["names"].get(winner) if winner is not None else None,
                "method": b.get("method"),
                "result_round": b.get("round"),
                "result_time": b.get("time"),
            })
            filled += 1
    if filled:
        print(f"  Backfilled results on {filled} archived fight(s).")
    print(f"Archive done: {total} new row(s).")


PRICE_GRACE_SECONDS = 180
# A fresh BetOnline market can't take verified bets for its first 30 minutes,
# so nobody farms the leaderboard off soft early openers. The lookback floor
# keeps an older fight of the same fighter from satisfying the check.
OPENER_EMBARGO_SECONDS = 30 * 60
OPENER_LOOKBACK_DAYS = 45


def _names_match(a, b):
    """Same fighter across spellings - the light local twin of the db
    matcher (exact, surname+initial, or token subset)."""
    na, nb = _nn(a), _nn(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    ta, tb = na.split(), nb.split()
    if ta[-1] == tb[-1] and ta[0][:1] == tb[0][:1]:
        return True
    sa, sb = set(ta), set(tb)
    return len(sa) >= 2 and len(sb) >= 2 and (sa <= sb or sb <= sa)


def _ledger_side(row, name):
    if _names_match(row.get("fighter1", ""), name):
        return "fighter1"
    if _names_match(row.get("fighter2", ""), name):
        return "fighter2"
    return None


def _iso_seconds_between(earlier, later):
    try:
        a = datetime.fromisoformat(str(earlier).replace("Z", "+00:00"))
        b = datetime.fromisoformat(str(later).replace("Z", "+00:00"))
        return abs((b - a).total_seconds())
    except (TypeError, ValueError):
        return None


def _embargo_window(placed_iso):
    """(cutoff_iso, floor_iso) for the opener check: the market must already
    have existed at cutoff (placed - embargo) for the bet to verify."""
    try:
        p = datetime.fromisoformat(str(placed_iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None, None
    cutoff = p - timedelta(seconds=OPENER_EMBARGO_SECONDS)
    floor = p - timedelta(days=OPENER_LOOKBACK_DAYS)
    return cutoff.isoformat(), floor.isoformat()


def _ml_opener_ok(name, placed_iso):
    """True when this fight's moneyline was already on the board at least
    OPENER_EMBARGO_SECONDS before the bet was logged. Fail-open on errors:
    the embargo must never falsely reject an honest bet."""
    cutoff, floor = _embargo_window(placed_iso)
    if cutoff is None:
        return True
    try:
        from db import fetch_ledger_rows_before
        rows = fetch_ledger_rows_before(name, cutoff, floor)
    except Exception:
        return True
    return any(_ledger_side(r, name) for r in rows)


def _prop_opener_ok(name, placed_iso, market, bet):
    """True when this exact prop outcome was already on the board at least
    OPENER_EMBARGO_SECONDS before the bet was logged. Fail-open on errors."""
    cutoff, floor = _embargo_window(placed_iso)
    if cutoff is None:
        return True
    try:
        from db import fetch_prop_ledger_before
        rows = fetch_prop_ledger_before(name, cutoff, floor)
    except Exception:
        return True
    return any(_prop_row_matches(r, market, name, bet) for r in rows)


def verify_bet_prices():
    """Server-side market check for verified BetOnline moneylines.

    The bet's placed_at is server-stamped (unforgeable) and the bots'
    ledger is server-collected, so comparing the two is tamper-proof:
      verified    - the claimed price WAS the board price at log time
                    (or the board moved to it within a short grace window)
      off-market  - the board showed something else; the real price is
                    stored alongside for everyone to see
      unavailable - the fight wasn't in the ledger around that moment
                    (bot downtime, or BOL hadn't boarded it) - never a
                    false rejection."""
    from db import get_unpriced_bol_bets, fetch_ledger_rows, set_price_check
    bets = get_unpriced_bol_bets()
    if not bets:
        return
    print(f"Price verification: checking {len(bets)} BetOnline bet(s)...")
    v = o = u = e = 0
    for b in bets:
        name = _bet_fighter_name(b)
        placed = b.get("placed_at")
        try:
            claimed = int(b.get("odds"))
        except (TypeError, ValueError):
            claimed = None
        if not name or not placed or claimed is None:
            set_price_check(b["id"], "unavailable", None)
            u += 1
            continue
        before, after = fetch_ledger_rows(name, placed)
        board_price = None
        for cand in before:
            side = _ledger_side(cand, name)
            if side and cand.get(f"{side}_odds") is not None:
                board_price = int(cand[f"{side}_odds"])
                break
        next_price = next_gap = None
        for cand in after:
            side = _ledger_side(cand, name)
            if side and cand.get(f"{side}_odds") is not None:
                next_price = int(cand[f"{side}_odds"])
                next_gap = _iso_seconds_between(placed, cand.get("captured_at"))
                break
        if board_price is not None and claimed == board_price:
            if _ml_opener_ok(name, placed):
                set_price_check(b["id"], "verified", board_price)
                v += 1
                print(f"  + {b['selection']}: board was {board_price:+d} at log time - verified")
            else:
                set_price_check(b["id"], "early_market", board_price)
                e += 1
                print(f"  ! {b['selection']}: logged within "
                      f"{OPENER_EMBARGO_SECONDS // 60}m of the opener - marked early")
        elif (next_price is not None and next_gap is not None
              and next_gap <= PRICE_GRACE_SECONDS and claimed == next_price):
            if _ml_opener_ok(name, placed):
                set_price_check(b["id"], "verified", next_price)
                v += 1
                print(f"  + {b['selection']}: board moved to {next_price:+d} "
                      f"within {int(next_gap)}s - verified")
            else:
                set_price_check(b["id"], "early_market", next_price)
                e += 1
                print(f"  ! {b['selection']}: logged within "
                      f"{OPENER_EMBARGO_SECONDS // 60}m of the opener - marked early")
        elif board_price is not None:
            set_price_check(b["id"], "off-market", board_price)
            o += 1
            print(f"  ! {b['selection']}: claimed {claimed:+d} but the board "
                  f"was {board_price:+d} - marked off-market")
        else:
            set_price_check(b["id"], "unavailable", None)
            u += 1
            print(f"  - {b['selection']}: no board data at log time")
    print(f"Price verification done: {v} verified, {o} off-market, "
          f"{u} unavailable, {e} early.")


_PROP_MARKET = {"method": "method", "round": "round",
                "method_round": "method_round", "over": "total", "under": "total"}


def _line_eq(a, b):
    try:
        return abs(float(a) - float(b)) < 1e-6
    except (TypeError, ValueError):
        return False


def _prop_row_matches(row, market, fighter_name, bet):
    """Does a prop-ledger row correspond to this bet's exact outcome?"""
    if row.get("market") != market:
        return False
    if market == "total":
        side = "over" if bet.get("bet_type") == "over" else "under"
        return row.get("ou_side") == side and _line_eq(row.get("ou_line"), bet.get("ou_line"))
    if not _names_match(row.get("fighter") or "", fighter_name):
        return False
    if market in ("method", "method_round"):
        if (row.get("method") or "") != (bet.get("prop_method") or ""):
            return False
    if market in ("round", "method_round"):
        if str(row.get("round")) != str(bet.get("prop_round")):
            return False
    return True


def verify_prop_prices():
    """Server-side market check for verified BetOnline PROP bets - the same
    tamper-proof comparison as moneylines (server-stamped log time vs the
    server-collected prop ledger), extended to method / round / method+round
    / totals. Verdicts: verified, off-market (real price stored), or
    unavailable (never a false rejection)."""
    from db import (get_unpriced_bol_props, fetch_prop_ledger, set_price_check,
                    get_fighter_names_for_source)
    bets = get_unpriced_bol_props()
    if not bets:
        return
    print(f"Prop verification: checking {len(bets)} BetOnline prop bet(s)...")
    names_by_url = {}
    v = o = u = e = 0
    for b in bets:
        url = b.get("event_source_url") or ""
        if url and url not in names_by_url:
            try:
                names_by_url[url] = get_fighter_names_for_source(url)
            except Exception:
                names_by_url[url] = {}
        name = (names_by_url.get(url, {}).get(str(b.get("fighter_id")))
                or _bet_fighter_name(b))
        market = _PROP_MARKET.get(b.get("bet_type"))
        placed = b.get("placed_at")
        try:
            claimed = int(b.get("odds"))
        except (TypeError, ValueError):
            claimed = None
        if not name or not placed or claimed is None or market is None:
            set_price_check(b["id"], "unavailable", None)
            u += 1
            continue
        before, after = fetch_prop_ledger(name, placed)
        board = next((int(r["odds"]) for r in before
                      if _prop_row_matches(r, market, name, b)
                      and r.get("odds") is not None), None)
        nxt = ngap = None
        for r in after:
            if _prop_row_matches(r, market, name, b) and r.get("odds") is not None:
                nxt = int(r["odds"])
                ngap = _iso_seconds_between(placed, r.get("captured_at"))
                break
        if board is not None and claimed == board:
            if _prop_opener_ok(name, placed, market, b):
                set_price_check(b["id"], "verified", board)
                v += 1
                print(f"  + {b['selection']}: board was {board:+d} at log time - verified")
            else:
                set_price_check(b["id"], "early_market", board)
                e += 1
                print(f"  ! {b['selection']}: logged within "
                      f"{OPENER_EMBARGO_SECONDS // 60}m of the opener - marked early")
        elif (nxt is not None and ngap is not None
              and ngap <= PRICE_GRACE_SECONDS and claimed == nxt):
            if _prop_opener_ok(name, placed, market, b):
                set_price_check(b["id"], "verified", nxt)
                v += 1
                print(f"  + {b['selection']}: board moved to {nxt:+d} within {int(ngap)}s - verified")
            else:
                set_price_check(b["id"], "early_market", nxt)
                e += 1
                print(f"  ! {b['selection']}: logged within "
                      f"{OPENER_EMBARGO_SECONDS // 60}m of the opener - marked early")
        elif board is not None:
            set_price_check(b["id"], "off-market", board)
            o += 1
            print(f"  ! {b['selection']}: claimed {claimed:+d} but the board was "
                  f"{board:+d} - marked off-market")
        else:
            set_price_check(b["id"], "unavailable", None)
            u += 1
            print(f"  - {b['selection']}: no prop board data at log time")
    print(f"Prop verification done: {v} verified, {o} off-market, "
          f"{u} unavailable, {e} early.")


def process_delete_requests():
    """Owner-requested bet removals, handled on every grading run.

    A request on a bet whose event HASN'T started is honored automatically -
    the pick was never public, so withdrawing it is harmless. Once the event
    has started, auto-deleting would let someone erase a losing pick, so the
    bet stays put and the request is surfaced for an admin decision (void or
    deny in the Admin tab)."""
    from db import get_delete_requests, delete_bet_row
    reqs = get_delete_requests()
    if not reqs:
        return
    now = datetime.now(timezone.utc)
    removed = held = 0
    for r in reqs:
        started = True
        es = r.get("event_start")
        if es:
            try:
                started = datetime.fromisoformat(
                    str(es).replace("Z", "+00:00")) <= now
            except ValueError:
                started = True
        elif r.get("event_date"):
            started = r["event_date"] < now.date().isoformat()
        if not started:
            delete_bet_row(r["id"])
            removed += 1
            print(f"  Removed on request (pre-start): {r['selection']}")
        else:
            held += 1
            print(f"  ! ADMIN REVIEW: removal requested after start - "
                  f"{r['selection']} ({r.get('result')}) - void or deny it "
                  f"in the Admin tab.")
    print(f"Removal requests: {removed} removed, {held} held for admin.")


def grade_pending_bets(cache=None):
    """Fetch results for finished events and settle every gradeable bet.
    Also processes owner removal requests first (part of the morning run)."""
    from db import get_pending_bets, settle_bet, annotate_bet
    if cache is None:
        cache = {}

    try:
        process_delete_requests()
    except Exception as e:
        print(f"! Removal-request pass failed: {e}")

    try:
        verify_bet_prices()
    except Exception as e:
        print(f"! Price-verification pass failed: {e}")

    try:
        verify_prop_prices()
    except Exception as e:
        print(f"! Prop-verification pass failed: {e}")

    today = date.today()

    def event_finished(b):
        ed = b.get("event_date")
        if not ed:
            return True
        try:
            return datetime.strptime(ed, "%Y-%m-%d").date() < today
        except ValueError:
            return True

    todo = []
    for b in get_pending_bets():
        if not event_finished(b):
            continue
        url = b.get("event_source_url") or ""
        gradeable = (("gidstats.com" in url or "sherdog.com" in url
                      or "onefc.com" in url) and b.get("fighter_id"))
        if not gradeable:
            # structured bet from a source we can't auto-grade: say so once
            if not b.get("grade_note"):
                annotate_bet(b["id"], "Auto-grade not available for this event - settle manually")
                print(f"  ?     {b['selection']}: can't auto-grade, settle manually")
            continue
        todo.append(b)

    if not todo:
        print("Bet grading: nothing to grade.")
        return

    print(f"Bet grading: checking {len(todo)} pending bet(s)...")
    graded = 0
    id_names_by_url = {}   # fighter_id -> name, from the fights table
    for b in todo:
        url = b["event_source_url"]
        if "gidstats.com" in url and url not in id_names_by_url:
            try:
                from db import get_fighter_names_for_source
                id_names_by_url[url] = get_fighter_names_for_source(url)
            except Exception:
                id_names_by_url[url] = {}
        bouts = _fetch_results(url, cache)
        if bouts is None and "sherdog.com" in url and _SHERDOG_BLOCKED:
            if not b.get("grade_note"):
                annotate_bet(b["id"], SHERDOG_BLOCKED_NOTE)
                print(f"  ?     {b['selection']}: {SHERDOG_BLOCKED_NOTE}")
            continue
        if not bouts:
            print(f"  - {b['selection']}: no results on the page yet")
            continue

        name = (id_names_by_url.get(url, {}).get(str(b.get("fighter_id")))
                or _bet_fighter_name(b))
        bout = next((x for x in bouts
                     if _bout_key_for(x, b["fighter_id"], name)), None)
        if bout is None:
            annotate_bet(b["id"], "Auto: bout not found on the results page - settle manually")
            print(f"  ? {b['selection']}: bout not found")
            continue

        my_key = _bout_key_for(bout, b["fighter_id"], name)
        my = bout["results"].get(my_key)
        bucket = method_bucket(bout["method"])

        # gidstats bout with a posted result but styled-only winner: totals
        # still grade off the clock; winner-dependent bets get the details
        # handed to manual settling instead of a guess.
        if (my is None and bout.get("attributed") is False
                and bucket not in ("nc", "draw")
                and b.get("bet_type") not in ("over", "under")):
            note = (f"Auto: result posted - {describe(bout)} - but the winner "
                    f"isn't machine-readable; settle manually")
            if b.get("grade_note") != note:
                annotate_bet(b["id"], note)
            print(f"  ?     {b['selection']}: winner needs manual confirm")
            continue

        # route the graded fighter through the bet's own fighter_id key
        shim = bout
        if my_key != b["fighter_id"]:
            shim = dict(bout)
            shim["names"] = dict(bout["names"])
            shim["results"] = dict(bout["results"])
            shim["names"][b["fighter_id"]] = bout["names"].get(my_key, name)
            shim["results"][b["fighter_id"]] = my

        result, note = grade_bet(b, shim)
        if result:
            settle_bet(b["id"], result, note)
            graded += 1
            print(f"  {result.upper():<5} {b['selection']}")
        elif note:
            annotate_bet(b["id"], note)
            print(f"  ?     {b['selection']}: {note}")
        else:
            print(f"  -     {b['selection']}: no result yet")
    print(f"Bet grading done: {graded} settled.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        url = sys.argv[1]
        if "gidstats.com" in url and "_vs_" in url:
            resp = http_client.get(url, timeout=30)
            resp.raise_for_status()
            p = parse_gid_bout_page(resp.text)
            print("DRY RUN - one gidstats bout:\n")
            for nm, slug in p["fighters"]:
                mark = " <- winner" if p["winner_slug"] == slug else ""
                print(f"  {nm}  [{slug}]{mark}")
            print(f"  {p['method'] or 'no result posted yet'}"
                  f"  R{p['round']}  {p['time']}")
            if p["method"] and not p["winner_slug"]:
                print("  (winner not machine-readable - would be flagged for "
                      "manual settling; totals still grade)")
        elif "gidstats.com" in url:
            bouts = fetch_gid_event_results(url, {}) or []
            print(f"DRY RUN - {len(bouts)} completed bout(s) parsed:\n")
            for bt in bouts:
                ids = list(bt["names"].keys())
                line = " vs ".join(
                    f"{bt['names'][i]} [{i}: {bt['results'][i]}]" for i in ids)
                print(f"  {line}")
                print(f"     {bt['method']}  R{bt['round']}  {bt['time']}"
                      f"  ({'attributed' if bt['attributed'] else 'winner needs manual confirm'})\n")
        else:
            parse = parse_onefc_results if "onefc.com" in url else parse_event_results
            resp = http_client.get(url, timeout=30)
            resp.raise_for_status()
            bouts = parse(resp.text)
            print(f"DRY RUN - {len(bouts)} completed bout(s) parsed:\n")
            for bt in bouts:
                ids = list(bt["names"].keys())
                line = " vs ".join(
                    f"{bt['names'][i]} [{i}: {bt['results'][i]}]" for i in ids)
                print(f"  {line}")
                print(f"     {bt['method']}  R{bt['round']}  {bt['time']}\n")
    else:
        grade_pending_bets()
