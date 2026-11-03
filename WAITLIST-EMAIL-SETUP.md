# Письма о поступлении

Лист ожидания уже хранится в Supabase. Почасовая синхронизация Ozon определяет переход товара из состояния «нет в наличии» в состояние «в продаже» и отправляет ожидающим покупателям письмо через Resend.

Для отправки писем в GitHub Actions Secrets должны находиться:

- `SUPABASE_URL` — `https://sprvfwqqqktrcmalzbcq.supabase.co`;
- `SUPABASE_SERVICE_ROLE_KEY` — секретный service role key проекта Supabase;
- `RESEND_API_KEY` — ключ бесплатного аккаунта Resend;
- `WAITLIST_FROM_EMAIL` — подтверждённый отправитель, например `Союз Мьюзик <shop@example.ru>`.

Страница Secrets: https://github.com/varvara9911/soyuz-music-store/settings/secrets/actions

Секретные значения нельзя записывать в репозиторий. Пока почтовые секреты не добавлены, запись покупателей в лист ожидания работает, но синхронизация только выводит в журнал сообщение о том, что отправка писем ещё не настроена.
