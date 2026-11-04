import html
import json
import os
import re
import smtplib
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from email.message import EmailMessage
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "products.json"
AVITO_REPORT = ROOT / "avito-price-report.json"
AVITO_XML_PRICES = ROOT / "avito-xml-prices.json"
API_ROOT = "https://api-seller.ozon.ru"
CLIENT_ID = os.environ.get("OZON_CLIENT_ID", "")
API_KEY = os.environ.get("OZON_API_KEY", "")
AVITO_API_ROOT = "https://api.avito.ru"
AVITO_CLIENT_ID = os.environ.get("AVITO_CLIENT_ID", "")
AVITO_CLIENT_SECRET = os.environ.get("AVITO_CLIENT_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
WAITLIST_FROM_EMAIL = os.environ.get("WAITLIST_FROM_EMAIL", "")
MAIL_SMTP_HOST = os.environ.get("MAIL_SMTP_HOST", "")
MAIL_SMTP_PORT = int(os.environ.get("MAIL_SMTP_PORT", "465") or 465)
MAIL_SMTP_USERNAME = os.environ.get("MAIL_SMTP_USERNAME", "")
MAIL_SMTP_PASSWORD = os.environ.get("MAIL_SMTP_PASSWORD", "")
MAIL_FROM_EMAIL = os.environ.get("MAIL_FROM_EMAIL", "")


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


def json_request(url, method="GET", payload=None, headers=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} for {url}: {body[:1000]}") from error


def send_waitlist_email(recipient, subject, html_body, text_body):
    if RESEND_API_KEY and WAITLIST_FROM_EMAIL:
        json_request(
            "https://api.resend.com/emails",
            method="POST",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            payload={
                "from": WAITLIST_FROM_EMAIL,
                "to": [recipient],
                "subject": subject,
                "html": html_body,
                "text": text_body,
            },
        )
        return "Resend"

    if all((MAIL_SMTP_HOST, MAIL_SMTP_USERNAME, MAIL_SMTP_PASSWORD, MAIL_FROM_EMAIL)):
        message = EmailMessage()
        message["From"] = MAIL_FROM_EMAIL
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
        if MAIL_SMTP_PORT == 465:
            with smtplib.SMTP_SSL(MAIL_SMTP_HOST, MAIL_SMTP_PORT, timeout=60) as smtp:
                smtp.login(MAIL_SMTP_USERNAME, MAIL_SMTP_PASSWORD)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(MAIL_SMTP_HOST, MAIL_SMTP_PORT, timeout=60) as smtp:
                smtp.starttls()
                smtp.login(MAIL_SMTP_USERNAME, MAIL_SMTP_PASSWORD)
                smtp.send_message(message)
        return "SMTP"

    raise RuntimeError("Email provider is not configured")


def notify_waitlist(products_by_offer):
    email_ready = (RESEND_API_KEY and WAITLIST_FROM_EMAIL) or all(
        (MAIL_SMTP_HOST, MAIL_SMTP_USERNAME, MAIL_SMTP_PASSWORD, MAIL_FROM_EMAIL)
    )
    if not all((SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)) or not email_ready:
        print(
            "Waitlist email is not configured: add Supabase secrets and either "
            "Resend or SMTP email secrets"
        )
        return

    query = (
        "/rest/v1/waitlist?select=id,email,customer_name,product_id,product_title"
        "&notified_at=is.null"
    )
    supabase_headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    try:
        rows = json_request(SUPABASE_URL + query, headers=supabase_headers) or []
    except Exception as error:
        # A temporary or misconfigured notification service must never block
        # catalog, price and stock synchronization.
        print(f"Waitlist lookup failed; catalog sync will continue: {error}")
        return
    sent = 0
    failed = 0
    provider = "none"
    for row in rows:
        product = products_by_offer.get(str(row.get("product_id")), {})
        if not product.get("available") or number(product.get("stock")) <= 0:
            continue
        product_title = row.get("product_title") or "Товар из листа ожидания"
        customer_name = row.get("customer_name") or "Здравствуйте"
        price = f"{number(product.get('price')):,}".replace(",", " ")
        subject = "Снова в наличии"
        html_body = (
            f"<p>{html.escape(customer_name)}, товар снова появился в наличии:</p>"
            f"<p><strong>{html.escape(product_title)}</strong></p>"
            f"<p>Цена: {price} ₽</p>"
            '<p><a href="https://soyuz-music-shop.github.io/soyuz-music-store/">'
            "Открыть магазин</a></p>"
            "<p>Вы получили письмо, потому что подписались на уведомление о поступлении.</p>"
        )
        text_body = (
            f"{customer_name}, товар снова появился в наличии:\n\n"
            f"{product_title}\nЦена: {price} ₽\n\n"
            "Открыть магазин: https://soyuz-music-shop.github.io/soyuz-music-store/\n\n"
            "Вы получили письмо, потому что подписались на уведомление о поступлении."
        )
        try:
            provider = send_waitlist_email(row.get("email"), subject, html_body, text_body)
            json_request(
                f"{SUPABASE_URL}/rest/v1/waitlist?id=eq.{row['id']}",
                method="PATCH",
                headers={**supabase_headers, "Prefer": "return=minimal"},
                payload={"notified_at": datetime.now(timezone.utc).isoformat()},
            )
            sent += 1
        except Exception as error:  # Keep the catalog sync running; retry this row next hour.
            failed += 1
            print(f"Waitlist email failed for row {row.get('id')}: {error}")
    print(f"Waitlist notifications sent: {sent} via {provider}; failed: {failed}")


def newsletter_matches(product, scope, artist):
    if product.get("badge") != "Новинка" or not product.get("available"):
        return False
    if scope == "artist":
        return text(product.get("artist")).casefold() == text(artist).casefold()
    edition = " ".join(
        text(value) for key, value in (product.get("specs") or {}).items()
        if "издани" in text(key).casefold()
    ).casefold()
    if scope == "import":
        return "импорт" in edition
    if scope == "russian":
        return "россий" in edition
    return True


def notify_newsletter(products_by_offer):
    email_ready = (RESEND_API_KEY and WAITLIST_FROM_EMAIL) or all(
        (MAIL_SMTP_HOST, MAIL_SMTP_USERNAME, MAIL_SMTP_PASSWORD, MAIL_FROM_EMAIL)
    )
    if not all((SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)) or not email_ready:
        print("Newsletter email is not configured; catalog sync will continue")
        return

    supabase_headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    query = (
        "/rest/v1/newsletter_preferences"
        "?select=user_id,email,customer_name,scope,artist,created_at&enabled=eq.true"
    )
    try:
        preferences = json_request(SUPABASE_URL + query, headers=supabase_headers) or []
    except Exception as error:
        print(f"Newsletter lookup failed; catalog sync will continue: {error}")
        return

    sent = 0
    failed = 0
    provider = "none"
    for preference in preferences:
        user_id = text(preference.get("user_id"))
        subscribed_date = text(preference.get("created_at"))[:10]
        scope = text(preference.get("scope")) or "all"
        artist = text(preference.get("artist"))
        try:
            delivery_query = (
                "/rest/v1/newsletter_deliveries?select=product_id&user_id=eq."
                + urllib.parse.quote(user_id, safe="")
            )
            deliveries = json_request(SUPABASE_URL + delivery_query, headers=supabase_headers) or []
            delivered_ids = {text(row.get("product_id")) for row in deliveries}
            products = [
                product for product in products_by_offer.values()
                if text(product.get("id")) not in delivered_ids
                and text(product.get("publishedAt")) >= subscribed_date
                and newsletter_matches(product, scope, artist)
            ]
            products.sort(key=lambda product: text(product.get("publishedAt")), reverse=True)
            products = products[:20]
            if not products:
                continue

            customer_name = text(preference.get("customer_name")) or "Здравствуйте"
            html_items = []
            text_items = []
            for product in products:
                product_name = " — ".join(filter(None, [text(product.get("artist")), text(product.get("title"))]))
                price = f"{number(product.get('price')):,}".replace(",", " ")
                html_items.append(
                    f"<li><strong>{html.escape(product_name)}</strong> — {price} ₽</li>"
                )
                text_items.append(f"• {product_name} — {price} ₽")
            scope_labels = {
                "all": "все новинки",
                "import": "импортные издания",
                "russian": "российские издания",
                "artist": f"новинки артиста {artist}",
            }
            scope_label = scope_labels.get(scope, "выбранные новинки")
            subject = "Новые поступления Союз Мьюзик"
            html_body = (
                f"<p>{html.escape(customer_name)}, у нас появились новые поступления "
                f"по вашей подписке «{html.escape(scope_label)}»:</p>"
                f"<ul>{''.join(html_items)}</ul>"
                '<p><a href="https://soyuz-music-shop.github.io/soyuz-music-store/#catalog">'
                "Открыть каталог</a></p>"
                "<p>Настройки подписки можно изменить в личном кабинете.</p>"
            )
            text_body = (
                f"{customer_name}, у нас появились новые поступления "
                f"по вашей подписке «{scope_label}»:\n\n"
                + "\n".join(text_items)
                + "\n\nОткрыть каталог: https://soyuz-music-shop.github.io/soyuz-music-store/#catalog"
                + "\n\nНастройки подписки можно изменить в личном кабинете."
            )
            provider = send_waitlist_email(preference.get("email"), subject, html_body, text_body)
            now = datetime.now(timezone.utc).isoformat()
            json_request(
                f"{SUPABASE_URL}/rest/v1/newsletter_deliveries?on_conflict=user_id,product_id",
                method="POST",
                headers={**supabase_headers, "Prefer": "resolution=ignore-duplicates,return=minimal"},
                payload=[
                    {"user_id": user_id, "product_id": text(product.get("id")), "sent_at": now}
                    for product in products
                ],
            )
            json_request(
                f"{SUPABASE_URL}/rest/v1/newsletter_preferences?user_id=eq.{urllib.parse.quote(user_id, safe='')}",
                method="PATCH",
                headers={**supabase_headers, "Prefer": "return=minimal"},
                payload={"last_sent_at": now},
            )
            sent += 1
        except Exception as error:
            failed += 1
            print(f"Newsletter email failed for user {user_id}: {error}")
    print(f"Newsletter messages sent: {sent} via {provider}; failed: {failed}")


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


def normalized_listing_text(value, strip_details=False):
    value = text(value).casefold().replace("ё", "е")
    if strip_details:
        value = re.sub(r"\([^)]*\)", " ", value)
    return re.sub(r"[^a-zа-я0-9]+", " ", value, flags=re.I).strip()


def product_listing_names(product, strip_details=False):
    artist = text(product.get("artist"))
    title = text(product.get("title"))
    candidates = [f"{artist} {title}", f"{artist}. {title}", title]
    return {
        normalized_listing_text(candidate, strip_details=strip_details)
        for candidate in candidates
        if normalized_listing_text(candidate, strip_details=strip_details)
    }


def normalized_identifiers(value):
    raw = text(value).upper()
    if not raw:
        return set()
    identifiers = {raw}
    identifiers.update(re.findall(r"(?<!\d)\d{8,14}(?!\d)", raw))
    return {
        identifier.lstrip("0") or "0"
        for identifier in identifiers
        if identifier
    }


def product_identifiers(product):
    values = [product.get("id")]
    for name, value in (product.get("specs") or {}).items():
        lowered = text(name).casefold()
        if any(needle in lowered for needle in ("артикул", "штрих", "код диска", "ean", "isbn")):
            values.append(value)
    identifiers = set()
    for value in values:
        identifiers.update(normalized_identifiers(value))
    return identifiers


def load_avito_xml_prices():
    if not AVITO_XML_PRICES.exists():
        return []
    payload = json.loads(AVITO_XML_PRICES.read_text(encoding="utf-8"))
    listings = []
    for item in payload.get("prices") or []:
        price = number(item.get("price"))
        offer_id = text(item.get("offerId"))
        if not offer_id or price <= 0:
            continue
        listings.append({
            "id": text(item.get("avitoId")) or offer_id,
            "offer_id": offer_id,
            "title": text(item.get("title")),
            "price": price,
        })
    return listings


def avito_access_token():
    payload = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": AVITO_CLIENT_ID,
        "client_secret": AVITO_CLIENT_SECRET,
    }).encode("utf-8")
    request = urllib.request.Request(
        AVITO_API_ROOT + "/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Avito token: HTTP {error.code}: {body[:1000]}") from error
    token = text(result.get("access_token"))
    if not token:
        raise RuntimeError("Avito token: access_token is missing")
    return token


def avito_items(access_token):
    items = []
    page = 1
    per_page = 100
    headers = {"Authorization": f"Bearer {access_token}"}
    while True:
        query = urllib.parse.urlencode({"page": page, "per_page": per_page})
        result = json_request(
            f"{AVITO_API_ROOT}/core/v1/items?{query}",
            headers=headers,
        ) or {}
        batch = result.get("resources") or result.get("items") or []
        items.extend(
            item for item in batch
            if text(item.get("status")).casefold() in ("", "active")
        )
        meta = result.get("meta") or {}
        pages = number(meta.get("pages") or meta.get("page_count"))
        if not batch or len(batch) < per_page or (pages and page >= pages):
            break
        page += 1
    return items


def apply_avito_prices(products, listings):
    full_names = {}
    base_names = {}
    for index, product in enumerate(products):
        for name in product_listing_names(product):
            full_names.setdefault(name, []).append(index)
        for name in product_listing_names(product, strip_details=True):
            base_names.setdefault(name, []).append(index)

    listing_full_names = {}
    listing_base_names = {}
    listings_by_offer_identifier = {}
    for listing in listings:
        full = normalized_listing_text(listing.get("title"))
        base = normalized_listing_text(listing.get("title"), strip_details=True)
        if full:
            listing_full_names.setdefault(full, []).append(listing)
        if base:
            listing_base_names.setdefault(base, []).append(listing)
        for identifier in normalized_identifiers(listing.get("offer_id")):
            listings_by_offer_identifier.setdefault(identifier, []).append(listing)

    matched = 0
    for product in products:
        ozon_price = number(product.get("price"))
        product["ozonPrice"] = ozon_price
        product["priceSource"] = "ozon"
        for key in ("avitoPrice", "_avitoItemId", "_avitoUpdatedAt"):
            product.pop(key, None)

        candidates = []
        for identifier in product_identifiers(product):
            matches = listings_by_offer_identifier.get(identifier, [])
            if len(matches) == 1:
                candidates = matches
                break
        specs = product.get("specs") or {}
        explicit = text(
            product.get("avitoId")
            or specs.get("Avito ID")
            or specs.get("ID Avito")
            or specs.get("ID объявления Avito")
        )
        if explicit and not candidates:
            candidates = [listing for listing in listings if text(listing.get("id")) == explicit]
        if not candidates:
            for name in product_listing_names(product):
                if len(full_names.get(name, [])) == 1 and len(listing_full_names.get(name, [])) == 1:
                    candidates = listing_full_names[name]
                    break
        if not candidates:
            for name in product_listing_names(product, strip_details=True):
                if len(base_names.get(name, [])) == 1 and len(listing_base_names.get(name, [])) == 1:
                    candidates = listing_base_names[name]
                    break
        if len(candidates) != 1:
            continue
        listing = candidates[0]
        avito_price = number(listing.get("price"))
        if avito_price <= 0:
            continue
        product["price"] = avito_price
        product["avitoPrice"] = avito_price
        product["priceSource"] = "avito"
        product["_avitoItemId"] = text(listing.get("id"))
        product["_avitoUpdatedAt"] = datetime.now(timezone.utc).isoformat()
        matched += 1
    return matched


def write_avito_report(products, status, listings_count=0, error=""):
    unmatched = [
        {
            "id": text(product.get("id")),
            "artist": text(product.get("artist")),
            "title": text(product.get("title")),
            "ozonPrice": number(product.get("ozonPrice") or product.get("price")),
            "available": product.get("available") is not False,
        }
        for product in products
        if product.get("priceSource") != "avito"
    ]
    matched = sum(product.get("priceSource") == "avito" for product in products)
    report = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "listings": listings_count,
        "matched": matched,
        "unmatchedCount": len(unmatched),
        "error": text(error),
        "unmatched": unmatched,
    }
    AVITO_REPORT.write_text(
        json.dumps(report, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


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
    return created.isoformat(), "Новинка" if 0 <= age_days <= 7 else ""


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
    avito_matched = 0
    avito_status = "not_configured"
    avito_listings_count = 0
    avito_error = ""
    xml_listings = load_avito_xml_prices()
    if xml_listings:
        avito_listings_count = len(xml_listings)
        avito_matched = apply_avito_prices(products, xml_listings)
        avito_status = "xml"
        print(f"Avito XML prices: {avito_matched} matched from {len(xml_listings)} entries")
    elif AVITO_CLIENT_ID and AVITO_CLIENT_SECRET:
        try:
            listings = avito_items(avito_access_token())
            avito_listings_count = len(listings)
            avito_matched = apply_avito_prices(products, listings)
            avito_status = "success"
            print(f"Avito prices: {avito_matched} matched from {len(listings)} active listings")
        except Exception as error:
            # Avito is an optional price source. Ozon prices remain the safe fallback.
            apply_avito_prices(products, [])
            avito_status = "error"
            avito_error = text(error)
            print(f"Avito prices skipped; Ozon fallback is active: {error}")
    else:
        apply_avito_prices(products, [])
        print("Avito prices are not configured; Ozon fallback is active")
    write_avito_report(products, avito_status, avito_listings_count, avito_error)
    by_offer = {text(product.get("id")): product for product in products if text(product.get("id"))}
    products.sort(key=lambda product: product.get("publishedAt", ""), reverse=True)
    CATALOG.write_text(
        json.dumps(products, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    notify_waitlist(by_offer)
    notify_newsletter(by_offer)
    print(
        f"Ozon sync: {len(info)} API products, {added} added, {changed} changed, "
        f"{len(products)} total, {avito_matched} Avito prices at "
        f"{datetime.now(timezone.utc).isoformat()}"
    )


if __name__ == "__main__":
    main()
