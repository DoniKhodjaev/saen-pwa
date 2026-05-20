# Saen — saen.uz

Кураторский PWA-маркетплейс премиальной косметики для Ташкента.
Запуск Edit N°I (Hifz) — 1 ноября 2026.

## Структура

```
/                       Лендинг (cold traffic из Instagram)
/app                    PWA-приложение (каталог, корзина, заказы, коллекция)
/api/notify-order       Serverless function — пересылает заказы в Telegram
```

## Стек

- HTML/CSS/JS — без сборки, всё инлайн
- Vercel Edge Functions для `/api`
- Service Worker для офлайн и обновлений
- Cormorant Garamond + Inter + JetBrains Mono из Google Fonts

## Деплой

1. Push в `main` → Vercel автоматически деплоит
2. Environment variables (Vercel → Settings → Environment Variables):
   - `TELEGRAM_BOT_TOKEN` — токен из @BotFather
   - `TELEGRAM_CHAT_ID` — chat_id из /getUpdates

Подробности — `TELEGRAM_SETUP.md`.

## Обновления PWA

При деплое новой версии:
1. В `app/sw.js` поменяй строку `VERSION` (например, добавь сегодняшнюю дату)
2. Запушь — клиенты с установленным PWA увидят плашку «Доступно обновление»

Без смены VERSION старые клиенты будут продолжать видеть закэшированную версию.
