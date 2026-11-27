"""Read-only public catalog, using only the Store database."""
from contextlib import contextmanager
from typing import Literal
from urllib.parse import urlsplit
from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.db import engine

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])
CATEGORY = """CASE p.card->>'media'
 WHEN 'Виниловая пластинка' THEN 'vinyl'
 WHEN 'Компакт-диск' THEN 'cd'
 WHEN 'Аудиокассета' THEN 'tape'
 WHEN 'DVD' THEN 'movie'
 WHEN 'Blu-ray' THEN 'movie'
 ELSE 'other' END"""
JOIN = """ FROM store.catalog_products p
 JOIN store.catalog_stock s USING(ean)
 JOIN store.catalog_prices r USING(ean) """
SORT = {
    "title": "lower(p.card->>'name'), p.ean",
    "new": "p.card->>'created_at' DESC NULLS LAST, p.ean",
    "price-asc": "r.amount_minor ASC NULLS LAST, p.ean",
    "price-desc": "r.amount_minor DESC NULLS LAST, p.ean",
}
Category = Literal["all", "vinyl", "cd", "tape", "movie", "other"]
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
        "media": public_text(c.get("media")), "category": row["category"],
        "edition": public_text(c.get("edition")), "image": primary,
        "price_minor": price, "currency": "RUB",
        "price_status": "available" if price is not None else "unavailable",
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

def filters(q, category, in_stock, max_price_minor):
    parts, params = [], {}
    if q.strip():
        parts.append("""(strpos(lower(p.card->>'name'), lower(:q)) > 0
            OR strpos(lower(coalesce(p.card->>'artist','')), lower(:q)) > 0
            OR strpos(lower(p.ean), lower(:q)) > 0)""")
        params["q"] = q.strip()
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

@router.get("")
def catalog(response: Response, q: str = Query("", max_length=160),
            category: Category = "all", in_stock: bool = False,
            max_price_minor: int | None = Query(None, ge=0, le=10000000000),
            sort: Sort = "new", limit: int = Query(48, ge=1, le=100),
            offset: int = Query(0, ge=0, le=50000)):
    no_cache(response)
    where, params = filters(q, category, in_stock, max_price_minor)
    with read_catalog() as conn:
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
            min(s.source_updated_at) AS oldest_stock_as_of,
            max(s.source_updated_at) AS newest_stock_as_of""" + JOIN)).mappings().one())
        categories = dict(conn.execute(text("SELECT " + CATEGORY + " AS category, count(*)" + JOIN + " GROUP BY 1")).all())
        imported = conn.execute(text("SELECT max(imported_at) FROM store.catalog_imports")).scalar_one()
        return {**totals, "categories": categories, "imported_at": imported,
                "data_mode": "snapshot", "sales_enabled": False}

@router.get("/item")
def item(response: Response, ean: str = Query(..., min_length=1, max_length=240)):
    no_cache(response)
    with read_catalog() as conn:
        row = conn.execute(text("SELECT " + COLS + JOIN + " WHERE p.ean = :ean"),
                           {"ean": ean}).mappings().one_or_none()
        if row is None:
            raise HTTPException(404, "Product not found")
        return public_item(row, detail=True)
