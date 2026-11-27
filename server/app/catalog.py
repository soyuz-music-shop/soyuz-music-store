"""Read-only public catalog, using only the Store database."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import re
import json
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.db import engine
from app.catalog_names import artist_key, display_name, filter_artist

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])
CATEGORY = """CASE
 WHEN coalesce(p.card->>'media','') = '' AND p.card->>'name' ~* '\\(книга([[:space:],/][^()]*)?\\)[[:space:]]*$' THEN 'book'
 ELSE CASE p.card->>'media'
 WHEN 'Виниловая пластинка' THEN 'vinyl'
 WHEN 'Компакт-диск' THEN 'cd'
 WHEN 'Аудиокассета' THEN 'tape'
 WHEN 'DVD' THEN 'movie'
 WHEN 'Blu-ray' THEN 'movie'
 ELSE 'other' END END"""
JOIN = """ FROM store.catalog_products p
 JOIN store.catalog_stock s USING(ean)
 JOIN store.catalog_prices r USING(ean) """
SORT = {
    "title": "lower(p.card->>'name'), p.ean",
    "new": "p.card->>'created_at' DESC NULLS LAST, p.ean",
    "price-asc": "r.amount_minor ASC NULLS LAST, p.ean",
    "price-desc": "r.amount_minor DESC NULLS LAST, p.ean",
}
Category = Literal["all", "vinyl", "cd", "tape", "movie", "book", "other"]
Edition = Literal["all", "import", "russian"]
Sort = Literal["title", "new", "price-asc", "price-desc"]

@contextmanager
def read_catalog():
    db = engine()
    try:
        with db.connect() as conn:
            conn.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            conn.execute(text("SET LOCAL statement_timeout = 5000"))
            conn.execute(text("SET LOCAL lock_timeout = 500"))
            if conn.execute(text("SELECT revision FROM store.catalog_schema_revision")).scalars().all() != ["catalog_v1"]:
                raise HTTPException(503, "Catalog unavailable")
            yield conn
    except SQLAlchemyError:
        raise HTTPException(503, "Catalog unavailable") from None
    finally:
        db.dispose()

def public_text(value):
    return value if isinstance(value, str) else None

def image_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        u = urlsplit(value)
        if u.scheme == "https" and u.netloc == "ir.ozone.ru" and u.path.startswith("/"):
            return value
    except ValueError:
        pass
    return None

def recent_publication(value):
    if not isinstance(value, str) or not re.match(r"^\d{4}-\d{2}-\d{2}(?:$|T| )", value):
        return False
    try:
        published = date.fromisoformat(value[:10])
    except ValueError:
        return False
    today = datetime.now(timezone(timedelta(hours=3))).date()
    return 0 <= (today - published).days <= 7

def public_item(row, detail=False):
    c = row["card"]
    urls = list(dict.fromkeys(u for x in (c.get("images") or []) if (u := image_url(x))))
    primary = image_url(c.get("primary_image")) or (urls[0] if urls else None)
    if row["status"] != "MATCH":
        price = None
    else:
        price = row["amount_minor"]
    out = {
        "ean": row["ean"], "name": c["name"], "artist": public_text(c.get("artist")),
        "display": display_name(c["name"], public_text(c.get("artist"))),
        "media": public_text(c.get("media")), "category": row["category"],
        "edition": public_text(c.get("edition")), "image": primary,
        "price_minor": price, "currency": "RUB",
        "price_status": "available" if price is not None else "unavailable",
        "is_new": recent_publication(c.get("created_at")),
        "in_stock_at_snapshot": row["quantity"] > 0,
        "stock_as_of": row["source_updated_at"].isoformat(),
        "sales_enabled": False, "can_purchase": False,
    }
    if detail:
        out["images"] = urls
        for key in ("description", "genre", "publisher", "country", "year",
                    "media_qty", "packaging", "vinyl_color", "catalog_number",
                    "weight_g", "width_mm", "height_mm", "length_mm"):
            value = c.get(key)
            out[key] = value if type(value) in (str, int, float) else None
    return out

COLS = "p.ean,p.card,s.quantity,s.source_updated_at,r.amount_minor,r.status," + CATEGORY + " AS category"

SEARCH_TEXT = """regexp_replace(translate(lower(concat_ws(' ', p.ean,
    p.card->>'name', p.card->>'artist', p.card->>'media', p.card->>'edition',
    p.card->>'genre', p.card->>'publisher', p.card->>'country', p.card->>'year',
    p.card->>'catalog_number', p.card->>'packaging', p.card->>'vinyl_color',
    p.card->>'media_qty', regexp_replace(coalesce(p.card->>'description',''), '<[^>]*>', ' ', 'g')
    )), 'ё', 'е'), '[^a-zа-я0-9]+', ' ', 'g')"""

def search_tokens(q):
    return list(dict.fromkeys(re.findall(r"[a-zа-я0-9]+", q.lower().replace("ё", "е"))))

def filters(q, category, in_stock, max_price_minor, edition="all"):
    parts, params = [], {}
    if q.strip():
        tokens = search_tokens(q)
        if not tokens:
            parts.append("p.ean = :exact_query")
            params["exact_query"] = q.strip()
        else:
            # AND across query tokens, independent of order; exact EAN is always accepted.
            parts.append("(CASE WHEN EXISTS (SELECT 1 FROM store.catalog_products exact WHERE exact.ean = :exact_query) THEN p.ean = :exact_query ELSE " + SEARCH_TEXT + " LIKE ALL(CAST(:patterns AS text[])) END)")
            params.update(exact_query=q.strip(), patterns=["%" + token + "%" for token in tokens])
    if edition != "all":
        parts.append(":edition_name = ANY(regexp_split_to_array(lower(btrim(coalesce(p.card->>'edition',''))), '[[:space:]]*[;,|·][[:space:]]*'))")
        params["edition_name"] = {"import":"импортное", "russian":"российское"}[edition]
    if category != "all":
        parts.append("(" + CATEGORY + ") = :category")
        params["category"] = category
    if in_stock:
        parts.append("s.quantity > 0")
    if max_price_minor is not None:
        parts.append("r.status = 'MATCH' AND r.amount_minor <= :max_price_minor")
        params["max_price_minor"] = max_price_minor
    return (" WHERE " + " AND ".join(parts) if parts else ""), params

def no_cache(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"

def artist_rows(conn):
    # Only lightweight name fields; no descriptions or image arrays.
    rows = conn.execute(text("SELECT p.ean, p.card->>'name' AS name, p.card->>'artist' AS artist" + JOIN + " ORDER BY p.ean")).mappings()
    for row in rows:
        name = filter_artist(display_name(row["name"], row["artist"]))
        if name:
            yield row["ean"], name

@router.get("/artists")
def artists(response: Response):
    no_cache(response)
    with read_catalog() as conn:
        result = {}
        for ean, name in artist_rows(conn):
            key = artist_key(name)
            item = result.setdefault(key, {"name": name, "count": 0})
            item["count"] += 1
        return {"items": sorted(result.values(), key=lambda item: artist_key(item["name"])), "total": len(result)}

@router.get("")
def catalog(response: Response, q: str = Query("", max_length=160),
            category: Category = "all", in_stock: bool = False,
            edition: Edition = "all",
            artist: str = Query("", max_length=240), artist_exact: bool = False,
            max_price_minor: int | None = Query(None, ge=0, le=10000000000),
            sort: Sort = "new", limit: int = Query(48, ge=1, le=100),
            offset: int = Query(0, ge=0, le=50000)):
    no_cache(response)
    where, params = filters(q, category, in_stock, max_price_minor, edition)
    with read_catalog() as conn:
        selected = artist_key(artist)
        if selected:
            matches = [ean for ean, name in artist_rows(conn)
                       if (artist_key(name) == selected if artist_exact else selected in artist_key(name))]
            where += (" AND " if where else " WHERE ") + "p.ean = ANY(CAST(:artist_eans AS text[]))"
            params["artist_eans"] = matches
        total = conn.execute(text("SELECT count(*)" + JOIN + where), params).scalar_one()
        rows = conn.execute(text("SELECT " + COLS + JOIN + where + " ORDER BY " +
                            SORT[sort] + " LIMIT :limit OFFSET :offset"),
                            {**params, "limit": limit, "offset": offset}).mappings().all()
        return {"items": [public_item(r) for r in rows], "total": total,
                "limit": limit, "offset": offset, "sales_enabled": False,
                "data_mode": "snapshot", "next_offset": offset + len(rows) if offset + len(rows) < total else None}

@router.get("/summary")
def summary(response: Response):
    no_cache(response)
    with read_catalog() as conn:
        totals = dict(conn.execute(text("""SELECT count(*) AS total,
            count(*) FILTER (WHERE s.quantity > 0) AS in_stock,
            count(*) FILTER (WHERE r.status = 'MATCH') AS priced,
            count(*) FILTER (WHERE r.status <> 'MATCH') AS unpriced,
            count(*) FILTER (WHERE s.quantity > 0 AND r.status = 'MATCH') AS priced_in_stock,
            count(*) FILTER (WHERE s.quantity > 0 AND r.status <> 'MATCH') AS unpriced_in_stock,
            max(r.amount_minor) FILTER (WHERE r.status = 'MATCH') AS max_price_minor,
            min(s.source_updated_at) AS oldest_stock_as_of,
            max(s.source_updated_at) AS newest_stock_as_of""" + JOIN)).mappings().one())
        categories = dict(conn.execute(text("SELECT " + CATEGORY + " AS category, count(*)" + JOIN + " GROUP BY 1")).all())
        imported = conn.execute(text("SELECT max(imported_at) FROM store.catalog_imports")).scalar_one()
        return {**totals, "categories": categories, "imported_at": imported,
                "data_mode": "snapshot", "sales_enabled": False}


FEATURED_CONFIG = Path(__file__).resolve().parent / "storefront" / "featured.json"

@router.get("/featured")
def featured(response: Response):
    no_cache(response)
    try:
        config = json.loads(FEATURED_CONFIG.read_text(encoding="utf-8"))
        slides = config["slides"]
        if not isinstance(slides, list) or len(slides) > 100:
            raise ValueError("invalid slides")
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "Featured content unavailable") from None
    if not config.get("enabled"):
        return {"enabled": False, "slides": []}
    candidates = []
    for slide in slides:
        if not isinstance(slide, dict):
            continue
        ean, image = slide.get("ean"), slide.get("image")
        if not isinstance(ean, str) or not 1 <= len(ean) <= 240:
            continue
        if not isinstance(image, str) or not re.fullmatch(r"new-release-images/[a-zA-Z0-9._-]+\.webp", image):
            continue
        if not (FEATURED_CONFIG.parent / "assets" / image).is_file():
            continue
        candidates.append({"ean": ean, "image": "/assets/" + image,
                           **{key: str(slide.get(key) or "")[:1000] for key in ("artist", "title", "text")}})
    with read_catalog() as conn:
        ids = set(conn.execute(text("SELECT p.ean" + JOIN + " WHERE p.ean = ANY(CAST(:ids AS text[]))"),
                               {"ids": [s["ean"] for s in candidates]}).scalars())
    return {"enabled": True, "title": str(config.get("title") or "Новинки")[:200],
            "text": str(config.get("text") or "")[:2000],
            "autoplay": config.get("autoplay") is True,
            "intervalSeconds": min(20, max(3, int(config.get("intervalSeconds") or 5))),
            "slides": [s for s in candidates if s["ean"] in ids]}

@router.get("/item")
def item(response: Response, ean: str = Query(..., min_length=1, max_length=240)):
    no_cache(response)
    with read_catalog() as conn:
        row = conn.execute(text("SELECT " + COLS + JOIN + " WHERE p.ean = :ean"),
                           {"ean": ean}).mappings().one_or_none()
        if row is None:
            raise HTTPException(404, "Product not found")
        return public_item(row, detail=True)
