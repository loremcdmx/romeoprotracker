# RomeoPro Tracker

Трекер покерного марафона [Romeopro](https://forum.gipsyteam.ru/index.php?viewtopic=181676) на GipsyTeam — From Hero to Zero. С $10,000 до $10,000,000.

**Сайт:** [romeoprotracker.vercel.app](https://romeoprotracker.vercel.app)

## Что умеет

- 📈 График марафона с монотонными bezier-кривыми и данными по румам (GG, PS, King, Coin, Lux)
- 💬 Лента постов с фильтрами по лайкам, репе, автору
- 🔥 Топ постов с фильтрами по периоду (сегодня / неделя / месяц / мемы)
- 📊 Разбивка по темам (марафон / обсуждение / дебаты / флуд)
- 🌗 Светлая и тёмная тема
- 📱 Мобильная адаптация
- 🕷 Автоматический скрапер через GitHub Actions (каждые 30 мин)
- 🤖 Автораспознавание скриншотов БР через Claude API (vision)

## Стек

- **React + Vite** → деплой на Vercel
- **GitHub Actions** — cron-скрапер каждые 30 мин (новые посты + лайки), полный проход каждые 6 часов
- **Claude API** (Sonnet, vision) — автоматически извлекает данные о банкролле из скриншотов Ромео
- **Cheerio** — серверный парсинг HTML форума (без браузера)
- Данные хранятся как JSON в этом репо (`data/posts.json`, `data/meta.json`)

## Архитектура

```
src/
  App.jsx              — основной UI (~1700 строк)
  app.css              — стили (извлечены из JS)
  main.jsx             — точка входа
  storage.js           — загрузка данных с raw.githubusercontent.com
  utils.js             — хелперы, форматирование, bezier-кривые
  hooks/useIsMobile.js — реактивный медиа-запрос
  components/AnimatedValue.jsx — изолированный 60fps счётчик

scripts/
  scrape.mjs           — Node.js скрапер (GitHub Actions)

.github/workflows/
  scrape.yml           — cron: */30 + full scan каждые 6ч
```

## Данные

`data/posts.json` — посты форума (автор, текст, лайки, аватарка, рейтинг, изображения)
`data/meta.json` — метаданные + история БР по сессиям с разбивкой по румам

## Скрапер

Работает полностью автоматически через GitHub Actions:

| Режим | Частота | Что делает |
|-------|---------|------------|
| normal | каждые 30 мин | Новые посты + обновление лайков на последних 5 страницах |
| full | каждые 6 часов | Проход по всей теме, обновление лайков у всех постов |

Когда Ромео постит скриншот с банкроллом — Claude API автоматически распознаёт суммы по румам и обновляет `meta.json`.

Ручной запуск: GitHub → Actions → Scrape Forum → Run workflow.

## Деплой своего форка

1. Fork → Vercel → Add New Project → Deploy
2. GitHub Secrets: добавьте `ANTHROPIC_API_KEY` для автораспознавания скриншотов
3. Actions автоматически начнут работать после первого пуша в `main`
