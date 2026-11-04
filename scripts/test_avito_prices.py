import copy
import unittest

from scripts.sync_ozon import apply_avito_prices, normalized_identifiers


class AvitoPriceTests(unittest.TestCase):
    def setUp(self):
        self.products = [
            {
                "id": "SKU-RED",
                "artist": "Глеб Самойлоff & The Matrixx",
                "title": "Треш (2LP Red/Виниловая пластинка)",
                "price": 11550,
                "specs": {},
            },
            {
                "id": "SKU-BLACK",
                "artist": "Глеб Самойлоff & The Matrixx",
                "title": "Треш (2LP Black/Виниловая пластинка)",
                "price": 10050,
                "specs": {},
            },
            {
                "id": "SKU-CAN",
                "artist": "Can",
                "title": "Live In Stuttgart 1975 (2CD Digi)",
                "price": 6199,
                "specs": {"Avito ID": "999"},
            },
        ]

    def test_exact_title_uses_avito_and_unmatched_keeps_ozon(self):
        products = copy.deepcopy(self.products)
        matched = apply_avito_prices(products, [
            {"id": "101", "status": "active", "title": "Глеб Самойлоff & The Matrixx. Треш (2LP Red/Виниловая пластинка)", "price": 10990},
        ])
        self.assertEqual(matched, 1)
        self.assertEqual(products[0]["price"], 10990)
        self.assertEqual(products[0]["priceSource"], "avito")
        self.assertEqual(products[0]["ozonPrice"], 11550)
        self.assertEqual(products[1]["price"], 10050)
        self.assertEqual(products[1]["priceSource"], "ozon")

    def test_ambiguous_album_name_does_not_replace_price(self):
        products = copy.deepcopy(self.products[:2])
        matched = apply_avito_prices(products, [
            {"id": "102", "status": "active", "title": "Треш", "price": 9000},
        ])
        self.assertEqual(matched, 0)
        self.assertEqual([product["price"] for product in products], [11550, 10050])

    def test_explicit_avito_id_has_priority(self):
        products = copy.deepcopy(self.products)
        matched = apply_avito_prices(products, [
            {"id": "999", "status": "active", "title": "Название в Avito может отличаться", "price": 5990},
        ])
        self.assertEqual(matched, 1)
        self.assertEqual(products[2]["price"], 5990)
        self.assertEqual(products[2]["_avitoItemId"], "999")

    def test_xml_offer_id_matches_product_barcode(self):
        products = copy.deepcopy(self.products)
        products[2]["specs"]["Штрихкод"] = "05400863043407"
        matched = apply_avito_prices(products, [
            {
                "id": "8065933904",
                "offer_id": "5400863043407",
                "title": "Заголовок может отличаться",
                "price": 5790,
            },
        ])
        self.assertEqual(matched, 1)
        self.assertEqual(products[2]["price"], 5790)
        self.assertEqual(products[2]["_avitoItemId"], "8065933904")

    def test_identifier_normalization_ignores_barcode_leading_zero(self):
        self.assertIn("743219168320", normalized_identifiers("0743219168320"))


if __name__ == "__main__":
    unittest.main()
