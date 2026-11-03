import html
import json
import os
import re
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "products.json"
API_ROOT = "https://api-seller.ozon.ru"
CLIENT_ID = os.environ.get("OZON_CLIENT_ID", "")
API_KEY = os.environ.get("OZON_API_KEY", "")


def post(path, payload):
    request = urllib.request.Request(
        API_ROOT + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Client-Id": CLIENT_ID,
            "Api-Key": API_KEY,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ozon API {path}: HTTP {error.code}: {body[:1000]}") from error


def batches(values, size):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def text(value):
    return "" if value is None else str(value).strip()


def number(value):
    if value in (None, ""):
        return 0
    try:
        return int(round(float(str(value).replace(" ", "").replace(",", "."))))
    except ValueError:
        return 0


def clean_html(value):
    source = text(value)
    if not source:
        return ""
    source = re.sub(r"<br\s*/?>", "\n", source, flags=re.I)
    source = re.sub(r"</(?:p|div|li)\s*>", "\n", source, flags=re.I)
    source = re.sub(r"<li[^>]*>", "", source, flags=re.I)
    source = re.sub(r"<[^>]+>", "", source)
    source = html.unescape(source).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in source.splitlines()]
    return "\n".join(line for line in lines if line)


def split_name(name, fallback_artist=""):
    name = re.sub(r"\s+", " ", text(name)).strip()
    fallback_artist = text(fallback_artist)
    if not name:
        return fallback_artist or "Союз Мьюзик", ""
    if fallback_artist and name.casefold() == fallback_artist.casefold():
        return fallback_artist, ""
    if fallback_artist and name.casefold().startswith(fallback_artist.casefold()):
        remainder = name[len(fallback_artist):].lstrip(" .:—–-")
        if remainder:
            return fallback_artist, remainder
    for pattern in (r"\s+[—–-]\s+", r"\s*:\s+", r"\.\s+"):
        match = re.search(pattern, name)
        if match and match.start() > 0:
            return name[:match.start()].strip(), name[match.end():].strip()
    return fallback_artist or "Союз Мьюзик", name


def publication_badge(created_at):
    if not created_at:
        return "", ""
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00")).date()
    except ValueError:
        return "", ""
    age_days = (date.today() - created).days
    return created.isoformat(), "Новинка" if 0 <= age_days <= 30 else ""


def attribute_text(attribute):
    values = attribute.get("values") or []
    rendered = []
    for value in values:
        candidate = text(value.get("value") if isinstance(value, dict) else value)
        if candidate:
            rendered.append(candidate)
    return ", ".join(dict.fromkeys(rendered))


def attribute_map(item):
    result = {}
    for attribute in item.get("attributes") or []:
        name = text(attribute.get("name"))
        value = attribute_text(attribute)
        if name and value:
            result[name] = value
    for group in item.get("complex_attributes") or []:
        for attribute in group.get("attributes") or []:
            name = text(attribute.get("name"))
            value = attribute_text(attribute)
            if name and value and name not in result:
                result[name] = value
    return result


def find_spec(specs, *needles):
    for name, value in specs.items():
        lowered = name.casefold()
        if any(needle in lowered for needle in needles):
            return value
    return ""


def category_for(name, specs):
    source = " ".join([name, *specs.keys(), *specs.values()]).casefold()
    if "печатная книга" in source or "книга" in source:
        return "book"
    if "аудиокасс" in source or "кассет" in source or re.search(r"\bmc\b", source):
        return "tape"
    if "винил" in source or "пластин" in source or re.search(r"\blp\b", source):
        return "vinyl"
    if "фильм" in source or "dvd" in source or "blu-ray" in source:
        return "movie"
    return "cd"


def format_for(category, specs, name):
    source = " ".join([find_spec(specs, "носитель", "тип издания", "формат"), name]).casefold()
    if category == "vinyl" or re.search(r"\blp\b", source):
        return "LP"
    if category == "tape" or re.search(r"\bmc\b", source):
        return "MC"
    if category == "cd" or "компакт-диск" in source or re.search(r"\bcd\b", source):
        return "CD"
    return {"book": "Книга", "movie": "Видео"}.get(category, "")


def all_product_ids():
    product_ids = []
    last_id = ""
    while True:
        payload = {"filter": {"visibility": "ALL"}, "limit": 1000, "last_id": last_id}
        result = post("/v3/product/list", payload).get("result") or {}
        items = result.get("items") or []
        product_ids.extend(int(item["product_id"]) for item in items if item.get("product_id"))
        next_id = text(result.get("last_id"))
        if not items or not next_id or next_id == last_id:
            break
        last_id = next_id
    return list(dict.fromkeys(product_ids))


def product_info(product_ids):
    info = {}
    for product_batch in batches(product_ids, 1000):
        result = post("/v3/product/info/list", {"product_id": product_batch})
        for item in result.get("items") or []:
            offer_id = text(item.get("offer_id"))
            if offer_id:
                info[offer_id] = item
    return info


def product_attributes(product_ids):
    attributes = {}
    for product_batch in batches(product_ids, 1000):
        last_id = ""
        while True:
            payload = {
                "filter": {"product_id": [str(value) for value in product_batch], "visibility": "ALL"},
                "limit": 1000,
                "last_id": last_id,
                "sort_dir": "ASC",
            }
            result = post("/v4/product/info/attributes", payload)
            items = result.get("result") or result.get("items") or []
            for item in items:
                offer_id = text(item.get("offer_id"))
                if offer_id:
                    attributes[offer_id] = item
            next_id = text(result.get("last_id"))
            if not items or not next_id or next_id == last_id:
                break
            last_id = next_id
    return attributes


def product_description(offer_id):
    try:
        result = post("/v1/product/info/description", {"offer_id": offer_id}).get("result") or {}
        return clean_html(result.get("description"))
    except RuntimeError as error:
        print(f"Description skipped for {offer_id}: {error}")
        return ""


def stock_map():
    stocks = {}
    cursor = ""
    while True:
        payload = {"filter": {"visibility": "ALL"}, "limit": 1000}
        if cursor:
            payload["cursor"] = cursor
        result = post("/v4/product/info/stocks", payload)
        items = result.get("items") or []
        for item in items:
            offer_id = text(item.get("offer_id"))
            quantity = sum(
                max(number(stock.get("present")) - number(stock.get("reserved")), 0)
                for stock in item.get("stocks") or []
            )
            if offer_id:
                stocks[offer_id] = quantity
        next_cursor = text(result.get("cursor"))
        if not items or not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor
    return stocks


def image_urls(info, attributes):
    candidates = []
    for source in (info, attributes):
        primary = source.get("primary_image")
        if isinstance(primary, list):
            candidates.extend(primary)
        elif primary:
            candidates.append(primary)
        for image in source.get("images") or []:
            if isinstance(image, dict):
                candidates.append(image.get("file_name") or image.get("url") or image.get("default"))
            else:
                candidates.append(image)
        color = source.get("color_image")
        if color:
            candidates.append(color)
    return [text(url) for url in dict.fromkeys(candidates) if text(url).startswith(("http://", "https://"))]


def upsert_product(existing, offer_id, info, attributes, stock, fresh_description=""):
    specs = attribute_map(attributes)
    name = text(info.get("name") or attributes.get("name") or existing.get("title"))
    artist_hint = find_spec(specs, "исполнитель", "автор произведения", "автор книги", "автор")
    artist, title = split_name(name, artist_hint or existing.get("artist", ""))
    category = category_for(name, specs) if specs else existing.get("category", "cd")
    images = image_urls(info, attributes) or existing.get("images") or [existing.get("image", "")]
    images = [url for url in images if url]
    published_at, badge = publication_badge(info.get("created_at") or existing.get("publishedAt", ""))
    description = fresh_description or clean_html(info.get("description") or attributes.get("description")) or existing.get("description", "")
    price = number(info.get("price")) or existing.get("price", 0)
    old_price = number(info.get("old_price")) or existing.get("oldPrice", 0)
    year_value = find_spec(specs, "год издания", "год выпуска", "год выхода")
    year_match = re.search(r"(?:19|20)\d{2}", year_value)
    return {
        **existing,
        "id": offer_id,
        "category": category,
        "artist": artist or existing.get("artist", "Союз Мьюзик"),
        "title": title or existing.get("title", name),
        "price": price,
        "oldPrice": old_price,
        "available": stock > 0,
        "stock": stock,
        "year": int(year_match.group()) if year_match else existing.get("year", 0),
        "format": format_for(category, specs, name) or existing.get("format", ""),
        "detail": find_spec(specs, "тип носителя", "тип издания", "упаковк") or existing.get("detail", ""),
        "publishedAt": published_at or existing.get("publishedAt", ""),
        "badge": badge,
        "image": images[0] if images else existing.get("image", ""),
        "image2": images[1] if len(images) > 1 else existing.get("image2", ""),
        "images": images,
        "description": description,
        "specs": specs or existing.get("specs", {}),
        "genre": find_spec(specs, "жанр") or existing.get("genre", ""),
        "publisher": find_spec(specs, "издатель", "лейбл") or existing.get("publisher", ""),
        "source": existing.get("source") or "ozon-api",
        "_ozonUpdatedAt": text(info.get("updated_at")) or existing.get("_ozonUpdatedAt", ""),
    }


def main():
    if not CLIENT_ID or not API_KEY:
        print("Ozon API is not configured: add OZON_CLIENT_ID and OZON_API_KEY secrets")
        return

    products = json.loads(CATALOG.read_text(encoding="utf-8"))
    by_offer = {text(product.get("id")): product for product in products if text(product.get("id"))}
    product_ids = all_product_ids()
    info = product_info(product_ids)
    attributes = product_attributes(product_ids)
    stocks = stock_map()

    added = 0
    changed = 0
    for offer_id, item in info.items():
        existing = by_offer.get(offer_id, {})
        api_updated_at = text(item.get("updated_at"))
        previous_updated_at = text(existing.get("_ozonUpdatedAt"))
        needs_description = not existing or (previous_updated_at and api_updated_at and previous_updated_at != api_updated_at)
        description = product_description(offer_id) if needs_description else ""
        updated = upsert_product(
            existing,
            offer_id,
            item,
            attributes.get(offer_id, {}),
            stocks.get(offer_id, 0),
            description,
        )
        if not existing:
            added += 1
        elif updated != existing:
            changed += 1
        by_offer[offer_id] = updated

    products = list(by_offer.values())
    products.sort(key=lambda product: product.get("publishedAt", ""), reverse=True)
    CATALOG.write_text(
        json.dumps(products, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Ozon sync: {len(info)} API products, {added} added, {changed} changed, "
        f"{len(products)} total at {datetime.now(timezone.utc).isoformat()}"
    )


if __name__ == "__main__":
    main()
