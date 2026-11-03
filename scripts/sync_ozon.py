import json
import os
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
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ozon API {path}: HTTP {error.code}: {body[:500]}") from error


def batches(values, size):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def publication_badge(created_at):
    if not created_at:
        return "", ""
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00")).date()
    except ValueError:
        return "", ""
    age_days = (date.today() - created).days
    return created.isoformat(), "Новинка" if 0 <= age_days <= 30 else ""


def main():
    if not CLIENT_ID or not API_KEY:
        print("Ozon API is not configured: add OZON_CLIENT_ID and OZON_API_KEY secrets")
        return
    products = json.loads(CATALOG.read_text(encoding="utf-8"))
    by_offer = {str(product["id"]): product for product in products}
    offer_ids = list(by_offer)

    for offer_batch in batches(offer_ids, 1000):
        result = post("/v3/product/info/list", {"offer_id": offer_batch})
        for item in result.get("items", []):
            product = by_offer.get(str(item.get("offer_id", "")))
            if not product:
                continue
            published_at, badge = publication_badge(item.get("created_at", ""))
            product["publishedAt"] = published_at
            product["badge"] = badge

    for product in products:
        product["stock"] = 0
        product["available"] = False

    cursor = ""
    while True:
        payload = {
            "filter": {"visibility": "ALL"},
            "limit": 1000,
        }
        if cursor:
            payload["cursor"] = cursor
        result = post("/v4/product/info/stocks", payload)
        for item in result.get("items", []):
            product = by_offer.get(str(item.get("offer_id", "")))
            if not product:
                continue
            quantity = 0
            for stock in item.get("stocks", []):
                present = int(stock.get("present") or 0)
                reserved = int(stock.get("reserved") or 0)
                quantity += max(present - reserved, 0)
            product["stock"] = quantity
            product["available"] = quantity > 0
        next_cursor = result.get("cursor") or ""
        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor

    products.sort(key=lambda product: product.get("publishedAt", ""), reverse=True)
    CATALOG.write_text(
        json.dumps(products, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Updated {len(products)} products at {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
