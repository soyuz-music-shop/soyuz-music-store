import json

from sync_ozon import CATALOG, notify_newsletter, notify_waitlist, text


def main():
    products = json.loads(CATALOG.read_text(encoding="utf-8"))
    products_by_offer = {
        text(product.get("id")): product
        for product in products
        if text(product.get("id"))
    }
    notify_waitlist(products_by_offer)
    notify_newsletter(products_by_offer)


if __name__ == "__main__":
    main()
