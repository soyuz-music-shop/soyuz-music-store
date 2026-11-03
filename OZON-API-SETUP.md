# Подключение Ozon Seller API

Ключи вводятся только в закрытых полях GitHub Actions Secrets. В код сайта и `products.json` их добавлять нельзя.

1. Откройте `Settings → Secrets and variables → Actions` репозитория.
2. Нажмите `New repository secret` и добавьте `OZON_CLIENT_ID`.
3. Ещё раз нажмите `New repository secret` и добавьте `OZON_API_KEY`.
4. Откройте `Actions → Обновить каталог из Ozon → Run workflow`.

После первого запуска каталог будет каждый час обновлять:

- дату публикации карточки и метку «Новинка» за первые 30 дней;
- доступное количество с учётом резерва;
- наличие товара на сайте.
