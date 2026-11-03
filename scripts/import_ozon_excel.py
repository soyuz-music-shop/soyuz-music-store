import argparse
import html
import json
import re
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "products.json"


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
    source = re.sub(r"</p\s*>", "\n", source, flags=re.I)
    source = re.sub(r"<[^>]+>", "", source)
    source = html.unescape(source).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in source.splitlines()]
    return "\n".join(line for line in lines if line)


def normalize_header(value):
    return re.sub(r"\s+", " ", text(value).replace("*", "")).strip().casefold()


def split_name(name, fallback_artist=""):
    name = re.sub(r"\s+", " ", text(name)).strip()
    if not name:
        return text(fallback_artist), ""
    fallback_artist = text(fallback_artist)
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


def split_urls(value):
    return [item for item in re.split(r"[\s;]+", text(value)) if item.startswith(("http://", "https://"))]


def category_for(product_type, carrier):
    source = f"{text(product_type)} {text(carrier)}".casefold()
    if "печатная книга" in source or "книга" in source:
        return "book"
    if "винил" in source or "пластинка" in source or re.search(r"\blp\b", source):
        return "vinyl"
    if "аудиокасс" in source or "кассет" in source or re.search(r"\bmc\b", source):
        return "tape"
    if "фильм" in source or "dvd" in source or "blu-ray" in source:
        return "movie"
    return "cd"


def row_get(row, headers, *names):
    for name in names:
        index = headers.get(normalize_header(name))
        if index is not None and index < len(row):
            value = row[index]
            if value not in (None, ""):
                return value
    return ""


def make_specs(row, headers, category, artist, carrier, product_type):
    specs = {}

    def add(label, *names, transform=text):
        value = row_get(row, headers, *names)
        if value not in (None, ""):
            rendered = transform(value)
            if rendered not in (None, "", 0):
                specs[label] = rendered

    add("Артикул", "Артикул")
    add("Штрихкод", "Штрихкод (Серийный номер / EAN)")
    if product_type:
        specs["Тип товара"] = text(product_type)
    if artist:
        specs["Автор" if category == "book" else "Исполнитель"] = artist
    if carrier:
        specs["Тип носителя" if category != "book" else "Тип книги"] = text(carrier)
    add("Количество носителей", "Количество носителей, шт.", "Количество носителей")
    add("Упаковка", "Упаковка", "Тип обложки")
    weight = row_get(row, headers, "Вес в упаковке, г")
    if weight not in (None, ""):
        specs["Вес в упаковке"] = f"{number(weight)} г"
    add("Жанр", "Жанр музыки", "Направление")
    add("Издатель", "Издатель", "Бренд")
    add("Год издания", "Год издания", "Год выпуска")
    add("Страна", "Страна-изготовитель", "Страна производства")
    add("Издание", "Издание")
    add("Код диска", "Код диска")
    add("ISBN", "ISBN")
    add("Язык издания", "Язык издания")
    add("Количество страниц", "Количество страниц")
    return specs


def parse_workbook(path, existing):
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    raw_headers = next(sheet.iter_rows(min_row=2, max_row=2, values_only=True))
    headers = {normalize_header(value): index for index, value in enumerate(raw_headers) if value is not None}
    imported = []

    for row in sheet.iter_rows(min_row=5, values_only=True):
        product_id = text(row_get(row, headers, "Артикул"))
        product_name = text(row_get(row, headers, "Название товара"))
        if not product_id and not product_name:
            continue
        if not product_id or not product_name:
            continue

        product_type = row_get(row, headers, "Тип")
        carrier = row_get(row, headers, "Тип носителя", "Тип книги")
        category = category_for(product_type, carrier)
        old = existing.get(product_id, {})
        fallback_artist = row_get(row, headers, "Автор на обложке", "Автор", "Исполнитель") or old.get("artist", "")
        artist, title = split_name(product_name, fallback_artist)
        main_image = text(row_get(row, headers, "Ссылка на главное фото"))
        images = ([main_image] if main_image else []) + split_urls(row_get(row, headers, "Ссылки на дополнительные фото"))
        images = list(dict.fromkeys(images))
        description = clean_html(row_get(row, headers, "Аннотация"))
        genre = text(row_get(row, headers, "Жанр музыки", "Направление"))
        publisher = text(row_get(row, headers, "Издатель", "Бренд"))
        year = number(row_get(row, headers, "Год издания", "Год выпуска"))
        weight = number(row_get(row, headers, "Вес в упаковке, г"))
        product = {
            **old,
            "id": product_id,
            "category": category,
            "artist": artist,
            "title": title,
            "price": number(row_get(row, headers, "Предельная цена, руб.")),
            "oldPrice": number(row_get(row, headers, "Зачёркнутая цена, руб.")),
            "available": bool(old.get("available", False)),
            "year": year or number(old.get("year")),
            "format": text(carrier) or text(product_type),
            "detail": f"{weight} г" if weight else text(old.get("detail")),
            "publishedAt": text(old.get("publishedAt")),
            "badge": text(old.get("badge")),
            "image": main_image or text(old.get("image")),
            "image2": images[1] if len(images) > 1 else text(old.get("image2")),
            "images": images or old.get("images", []),
            "description": description or text(old.get("description")),
            "specs": make_specs(row, headers, category, artist, carrier, product_type),
            "genre": genre or text(old.get("genre")),
            "publisher": publisher or text(old.get("publisher")),
            "source": "book" if category == "book" else "music",
            "stock": number(old.get("stock")),
        }
        imported.append(product)

    workbook.close()
    return imported


def main():
    parser = argparse.ArgumentParser(description="Импорт Excel-шаблонов Ozon в каталог сайта")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    catalog_path = args.catalog
    output_path = args.output or catalog_path
    products = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else []
    existing = {str(product.get("id", "")): product for product in products}
    imported_count = 0

    for file_path in args.files:
        if not file_path.exists() or file_path.suffix.lower() != ".xlsx":
            continue
        batch = parse_workbook(file_path, existing)
        imported_count += len(batch)
        for product in batch:
            existing[str(product["id"])] = product

    result = list(existing.values())
    result.sort(key=lambda product: (text(product.get("publishedAt")), text(product.get("id"))), reverse=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Imported {imported_count} rows; catalog now has {len(result)} products")


if __name__ == "__main__":
    main()
