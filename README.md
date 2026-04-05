# 🎲 RomeoPro Tracker

Трекер покерного марафона [RomeoPro](https://forum.gipsyteam.ru/index.php?viewtopic=181676) — From Hero to Zero. С $10,000 до $10,000,000.

## Быстрый деплой (Vercel, 5 минут)

1. Форкните или загрузите репо на GitHub
2. Зайдите на [vercel.com](https://vercel.com) → **Add New Project** → выберите репо → **Deploy**
3. Сайт готов по адресу `https://romeoprotracker.vercel.app`

## Настройка

1. Откройте сайт → нажмите логотип 🎲 **5 раз** → введите пароль `romeo2026`
2. Заполните:
   - **Репозиторий**: `ваш-username/romeoprotracker`
   - **GitHub PAT**: токен из [github.com/settings/tokens](https://github.com/settings/tokens) (scope: `repo`)
3. Нажмите **Сохранить**

## Использование агента

1. Установите [Tampermonkey](https://www.tampermonkey.net/)
2. В Admin Mode нажмите **«Показать/скопировать код»**
3. Tampermonkey → Создать новый скрипт → Ctrl+A → Ctrl+V → Ctrl+S
4. Нажмите **▶ Запустить агента** — агент сам пройдёт по форуму и загрузит данные

## Смена пароля

В `src/App.jsx` найдите строку:
```js
const ADMIN_KEY = 'romeo2026'
```
