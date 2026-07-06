"""
Supabase writer for Regionals Matrix.
Non-destructive: find-or-insert events and fights. Never touches user_fight_data.

July 2026: cards now come from gidstats.com instead of Sherdog, so matching
got source-agnostic:
  - events match on (org, event_date) even when the source URL changed, and
    the row's source_url is migrated to the new page (bets keep grading);
  - fights match on accent/case-insensitive names ("Nicolas Savio" from an
    old Sherdog scrape == "Nicolas Sávio" from gidstats);
  - a fighter ID already on a row is never overwritten - Sherdog numeric IDs
    stay put so old notes keep surfacing - and brand-new fights reuse a
    fighter's existing ID (from current fights or the results archive)
    whenever the name maps to exactly one known ID.
"""

import os
import re
import unicodedata
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def norm_name(n):
    """Accent-stripped, lowercased, single-spaced fighter name."""
    s = unicodedata.normalize("NFD", n or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def delete_past_events():
    """Remove events whose date is before today. Cascades to their fights
    and any user notes/prices on them."""
    from datetime import date
    today = date.today().isoformat()
    res = supabase.table("events").delete().lt("event_date", today).execute()
    n = len(res.data) if res.data else 0
    print(f"Deleted {n} past event(s).")
    return n


def _tokens(name):
    return set(norm_name(name).split())


def _same_person(row_norm, inc_norm, inc_slug=None, allow_initial=False):
    """Do two name spellings refer to the same fighter? Catches the alias
    variants gidstats and Sherdog disagree on:
      'Vlastislav Cepo'      vs 'Vlasto Cepo'        (surname + initial)
      'Ramazonbek Temirov'   vs 'Ramazan Temirov'    (surname + initial)
      'Michel Pereira'       vs 'Michel Pereira Lima' (token subset)
      'Aziz Osorbek Uulu'    vs 'Azizbek Satibaldiev' + slug aziz_osorbek_uulu
                                                      (slug tokens = old name)
    The surname+initial rule is only used with allow_initial=True (inside a
    single bout, where the opponent anchors identity) - it is too loose for
    global lookups."""
    if not row_norm or not inc_norm:
        return False
    if row_norm == inc_norm:
        return True
    ra, ia = row_norm.split(), inc_norm.split()
    rt, it = set(ra), set(ia)
    if len(rt) >= 2 and len(it) >= 2 and (rt <= it or it <= rt):
        return True
    if inc_slug:
        st = set(norm_name(re.sub(r"[_\-]+", " ", str(inc_slug))).split())
        if len(st) >= 2 and len(rt) >= 2 and (st == rt or st <= rt or rt <= st):
            return True
    if allow_initial and ra and ia:
        if ra[-1] == ia[-1] and ra[0][:1] == ia[0][:1]:
            return True
    return False


def upsert_event(org, event_name, event_date, location=None,
                 source_url=None, event_time=None):
    """Find an event by (org, event_date); insert if missing. Returns the
    event id. Survives a source switch: an existing row keeps its id (and
    all fights/notes/prices under it) while source_url, name, and time are
    refreshed to the new page."""
    q = (supabase.table("events")
         .select("id, event_time, location, event_name, source_url")
         .eq("org", org)
         .eq("event_date", event_date)
         .execute())
    rows = q.data or []

    row = None
    if rows:
        row = next((r for r in rows if r.get("source_url") == source_url), None)
        if row is None and len(rows) == 1:
            row = rows[0]
        if row is None:
            # Same org twice on one date (rare): pick the row whose name
            # shares a number or 2+ words with the incoming name.
            new_t = _tokens(event_name)
            best, best_score = None, 0
            for r in rows:
                ov = _tokens(r.get("event_name")) & new_t
                score = len(ov) + (2 if any(t.isdigit() for t in ov) else 0)
                if score > best_score:
                    best, best_score = r, score
            if best_score >= 3:
                row = best

    if row:
        event_id = row["id"]
        updates = {}
        if event_name and event_name != row.get("event_name"):
            updates["event_name"] = event_name
        if source_url and source_url != row.get("source_url"):
            updates["source_url"] = source_url
        if event_time and event_time != row.get("event_time"):
            updates["event_time"] = event_time
        if location and not row.get("location"):
            updates["location"] = location
        if updates:
            supabase.table("events").update(updates).eq("id", event_id).execute()
        return event_id

    ins = (supabase.table("events").insert({
        "org": org,
        "event_name": event_name,
        "event_date": event_date,
        "location": location,
        "source_url": source_url,
        "event_time": event_time,
    }).execute())
    return ins.data[0]["id"]


# ---- fighter identity map: normalized name -> known fighter IDs ----------

_identity_map = None


def _load_identity_map():
    """Every (name -> id) pairing we've ever stored, from live fights and the
    results archive. Lets a new booking reuse a fighter's existing ID (Sherdog
    numeric or ONE slug) so their note history keeps attaching."""
    global _identity_map
    if _identity_map is not None:
        return _identity_map
    _identity_map = {}

    def feed(rows):
        for r in rows or []:
            for nm, fid in ((r.get("fighter1_name"), r.get("fighter1_id")),
                            (r.get("fighter2_name"), r.get("fighter2_id"))):
                if nm and fid:
                    _identity_map.setdefault(norm_name(nm), set()).add(str(fid))

    try:
        q = (supabase.table("fights")
             .select("fighter1_name, fighter1_id, fighter2_name, fighter2_id")
             .execute())
        feed(q.data)
    except Exception as e:
        print(f"  ! identity map (fights) skipped: {e}")
    try:
        q = (supabase.table("user_fight_review")
             .select("fighter1_name, fighter1_id, fighter2_name, fighter2_id")
             .execute())
        feed(q.data)
    except Exception as e:
        print(f"  ! identity map (archive) skipped: {e}")
    return _identity_map


def resolve_fighter_id(name, incoming_id):
    """Prefer the ID this fighter is already known by, when unambiguous.
    Tries the exact normalized name first, then the strong alias rules
    (token subset, slug tokens); any ambiguity keeps the incoming ID."""
    m = _load_identity_map()
    nn = norm_name(name)
    ids = set(m.get(nn) or ())
    if not ids:
        for known, known_ids in m.items():
            if _same_person(known, nn, incoming_id):
                ids |= set(known_ids)
    if len(ids) == 1:
        return next(iter(ids))
    return incoming_id


def upsert_fight(event_id, fighter1_name, fighter2_name, weight_class=None,
                 is_main_event=False, bout_order=0,
                 fighter1_id=None, fighter2_id=None):
    """Insert a fight if it doesn't already exist for this event.

    Matching is two-pass and order-agnostic: exact normalized names first,
    then an alias-tolerant identity match (surname+initial, token-subset
    names, slug tokens) so a Sherdog-era 'Vlastislav Cepo vs Gilbert Urbina'
    row is adopted by gidstats' 'Vlasto Cepo vs Gilbert Urbina' instead of
    being pruned and re-inserted. On any match, stored names are synced to
    the incoming source (so future runs match exactly) while fighter IDs are
    backfilled only where the row has none - an existing ID is never
    overwritten."""
    q = (supabase.table("fights")
         .select("id, fighter1_name, fighter2_name, fighter1_id, fighter2_id, "
                 "weight_class")
         .eq("event_id", event_id)
         .execute())
    rows = q.data or []
    n1, n2 = norm_name(fighter1_name), norm_name(fighter2_name)

    def find(strict):
        for r in rows:
            r1 = norm_name(r.get("fighter1_name"))
            r2 = norm_name(r.get("fighter2_name"))
            for swapped, a, b, sa, sb in (
                    (False, n1, n2, fighter1_id, fighter2_id),
                    (True, n2, n1, fighter2_id, fighter1_id)):
                if strict:
                    if r1 == a and r2 == b:
                        return r, swapped
                elif (_same_person(r1, a, sa, allow_initial=True)
                        and _same_person(r2, b, sb, allow_initial=True)):
                    return r, swapped
        return None, False

    row, swapped = find(strict=True)
    if row is None:
        row, swapped = find(strict=False)

    if row:
        fight_id = row["id"]
        f1_id, f2_id = (fighter2_id, fighter1_id) if swapped else (fighter1_id, fighter2_id)
        f1_nm, f2_nm = ((fighter2_name, fighter1_name) if swapped
                        else (fighter1_name, fighter2_name))
        updates = {}
        if f1_nm and f1_nm != row.get("fighter1_name"):
            updates["fighter1_name"] = f1_nm
        if f2_nm and f2_nm != row.get("fighter2_name"):
            updates["fighter2_name"] = f2_nm
        if not row.get("fighter1_id"):
            fid = resolve_fighter_id(f1_nm, f1_id)
            if fid:
                updates["fighter1_id"] = fid
        if not row.get("fighter2_id"):
            fid = resolve_fighter_id(f2_nm, f2_id)
            if fid:
                updates["fighter2_id"] = fid
        if weight_class and not row.get("weight_class"):
            updates["weight_class"] = weight_class
        if updates:
            supabase.table("fights").update(updates).eq("id", fight_id).execute()
        return fight_id

    ins = (supabase.table("fights").insert({
        "event_id": event_id,
        "fighter1_name": fighter1_name,
        "fighter2_name": fighter2_name,
        "weight_class": weight_class,
        "is_main_event": is_main_event,
        "bout_order": bout_order,
        "fighter1_id": resolve_fighter_id(fighter1_name, fighter1_id),
        "fighter2_id": resolve_fighter_id(fighter2_name, fighter2_id),
    }).execute())
    return ins.data[0]["id"]


def prune_fights(event_id, keep_ids, max_removals=4):
    """Remove this event's fights that weren't seen on the latest scrape
    (changed matchups, cancelled bouts). Cascades to per-fight prices/notes;
    fighter notes and bets are unaffected. Safety valve: refuses to remove
    more than `max_removals` bouts in one pass, so a broken parse can never
    wipe a whole card."""
    q = (supabase.table("fights")
         .select("id, fighter1_name, fighter2_name")
         .eq("event_id", event_id)
         .execute())
    stale = [row for row in (q.data or []) if row["id"] not in keep_ids]
    if len(stale) > max_removals:
        print(f"  ! {len(stale)} stale bouts found - too many to prune safely; "
              f"skipping this event (likely a parse hiccup, will retry next run).")
        return 0
    removed = 0
    for row in stale:
        supabase.table("fights").delete().eq("id", row["id"]).execute()
        removed += 1
        print(f"  - Removed stale bout: {row['fighter1_name']} vs {row['fighter2_name']}")
    return removed


def get_delete_requests():
    """Verified bets whose owner clicked 'request removal'."""
    q = (supabase.table("user_bets")
         .select("id, selection, event_date, event_start, result, "
                 "delete_requested_at")
         .neq("bet_type", "other")
         .not_.is_("delete_requested_at", "null")
         .execute())
    return q.data or []


def delete_bet_row(bet_id):
    """Hard-delete a bet (service role; used for pre-start removal requests)."""
    supabase.table("user_bets").delete().eq("id", bet_id).execute()


def get_pending_bets():
    """Pending bets with a structured type (moneyline/props), for auto-grading."""
    q = (supabase.table("user_bets")
         .select("id, selection, fighter_id, bet_type, prop_method, prop_round, "
                 "ou_line, event_source_url, event_date, grade_note")
         .eq("result", "pending")
         .neq("bet_type", "other")
         .execute())
    return q.data or []


def settle_bet(bet_id, result, note):
    """Write an auto-graded result + note onto a bet. settled_by='auto' marks
    it final: the DB trigger stops users from flipping scraper-graded results."""
    supabase.table("user_bets").update(
        {"result": result, "grade_note": note,
         "settled_by": "auto"}).eq("id", bet_id).execute()


def annotate_bet(bet_id, note):
    """Attach a note to a bet without settling it."""
    supabase.table("user_bets").update(
        {"grade_note": note}).eq("id", bet_id).execute()


def get_ml_bets_needing_close():
    """Verified moneyline bets that don't yet have a closing line recorded.
    Carries the picked fighter's name so the feed can be matched."""
    q = (supabase.table("user_bets")
         .select("id, odds, book, event_date, selection, fighter_id, close_odds")
         .eq("bet_type", "moneyline")
         .is_("close_odds", "null")
         .execute())
    out = []
    for r in (q.data or []):
        # selection for a card-logged ML is just the fighter's name
        r["selection_fighter"] = (r.get("selection") or "").split(" by ")[0].split(" in ")[0].strip()
        out.append(r)
    return out


def set_bet_close(bet_id, close_odds, clv):
    supabase.table("user_bets").update(
        {"close_odds": close_odds, "clv": clv}).eq("id", bet_id).execute()


def get_fighter_names_for_source(source_url):
    """{fighter_id: fighter_name} for the fights stored under this source
    URL. The grader uses it to bridge a bet's fighter_id (often a legacy
    Sherdog numeric ID) to the fighter names gidstats bouts are keyed by -
    essential for over/unders, whose selection text has no fighter name."""
    q = (supabase.table("events").select("id")
         .eq("source_url", source_url).execute())
    out = {}
    for ev in (q.data or []):
        for f in get_fights_for_event(ev["id"]):
            for fid, nm in ((f.get("fighter1_id"), f.get("fighter1_name")),
                            (f.get("fighter2_id"), f.get("fighter2_name"))):
                if fid and nm:
                    out[str(fid)] = nm
    return out


def get_past_events():
    """Events whose date has passed (about to be deleted)."""
    from datetime import date
    today = date.today().isoformat()
    q = (supabase.table("events")
         .select("id, org, event_name, event_date, source_url")
         .lt("event_date", today)
         .execute())
    return q.data or []


def get_fights_for_event(event_id):
    q = (supabase.table("fights")
         .select("id, fighter1_name, fighter2_name, fighter1_id, fighter2_id, weight_class")
         .eq("event_id", event_id)
         .execute())
    return q.data or []


def get_user_prices_for_fights(fight_ids):
    """{(user_id, fight_id): row} for fights with at least one price filled."""
    q = (supabase.table("user_fight_data")
         .select("user_id, fight_id, price1, price2")
         .in_("fight_id", fight_ids)
         .execute())
    out = {}
    for r in (q.data or []):
        if (r.get("price1") or "").strip() or (r.get("price2") or "").strip():
            out[(r["user_id"], r["fight_id"])] = r
    return out


def get_matrix_for_fights(fight_ids):
    """{(user_id, fight_id): data} for fights with at least one matrix cell."""
    q = (supabase.table("user_fight_matrix")
         .select("user_id, fight_id, data")
         .in_("fight_id", fight_ids)
         .execute())
    out = {}
    for r in (q.data or []):
        d = r.get("data") or {}
        if any((v or "").strip() for m in d.values() for v in m.values()):
            out[(r["user_id"], r["fight_id"])] = d
    return out


def upsert_review_rows(rows):
    supabase.table("user_fight_review").upsert(
        rows, on_conflict="user_id,fight_id").execute()


def backfill_review_targets(max_age_days=45):
    """Archived rows still missing a result, grouped by results URL."""
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=max_age_days)).isoformat()
    q = (supabase.table("user_fight_review")
         .select("id, source_url, fighter1_id, fighter2_id, "
                 "fighter1_name, fighter2_name")
         .is_("f1_result", "null")
         .gte("event_date", cutoff)
         .execute())
    out = {}
    for r in (q.data or []):
        url = r.get("source_url") or ""
        if ("gidstats.com" in url or "sherdog.com" in url or "onefc.com" in url):
            out.setdefault(url, []).append(r)
    return out


def update_review_result(row_id, fields):
    supabase.table("user_fight_review").update(fields).eq("id", row_id).execute()
