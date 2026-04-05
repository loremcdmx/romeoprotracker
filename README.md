# 🎲 RomeoPro Tracker

Трекер покерного марафона [RomeoPro](https://forum.gipsyteam.ru/index.php?viewtopic=181676) — From Hero to Zero. С $10,000 до $10,000,000.

## Деплой на Vercel (рекомендуется, 5 минут)

### 1. Создайте репозиторий на GitHub

1. Зайдите на [github.com](https://github.com) → **New repository**
2. Название: `romeoprotracker`
3. Видимость: **Public** (нужно для GitHub Pages) или Private
4. Нажмите **Create repository**

### 2. Загрузите файлы

```bash
# На вашем компьютере:
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/ВАШ_USERNAME/romeoprotracker.git
git push -u origin main
```

Или загрузите файлы через веб-интерфейс GitHub (Upload files).

### 3. Деплой на Vercel

1. Зайдите на [vercel.com](https://vercel.com) → **Add New Project**
2. Выберите ваш репозиторий `romeoprotracker`
3. Нажмите **Deploy** — всё определяется автоматически
4. Через 1 минуту сайт доступен по адресу `https://romeoprotracker.vercel.app`

---

## Деплой на GitHub Pages (альтернатива)

### 1. Измените `vite.config.js`

```js
base: '/romeoprotracker/', // замените на имя вашего репозитория
```

### 2. Включите GitHub Pages

В репозитории: **Settings → Pages → Source → GitHub Actions**

### 3. Запушьте изменения

GitHub Actions автоматически соберёт и задеплоит сайт.

---

## Настройка GitHub PAT для обновления данных

Администратор обновляет данные через **Admin Mode** в приложении.  
Для записи в репозиторий нужен GitHub Personal Access Token.

### Создание PAT

1. [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Название: `romeoprotracker-write`
3. Срок: 90 дней (или без срока)
4. Разрешения: ✅ **repo** (полный доступ к репозиторию)
5. **Generate token** → скопируйте токен (показывается один раз!)

### Использование PAT в приложении

1. Откройте сайт → нажмите логотип 🎲 **5 раз** → введите пароль `romeo2026`
2. В Admin Mode заполните:
   - **Репозиторий**: `ваш-username/romeoprotracker`
   - **GitHub PAT**: вставьте токен
3. Нажмите **Сохранить** — токен хранится в localStorage (только на вашем компьютере)

---

## Использование агента Tampermonkey

### Установка

1. Установите [Tampermonkey](https://www.tampermonkey.net/) в браузер
2. В Admin Mode нажмите **«Скопировать код»**
3. Tampermonkey → **Создать новый скрипт** → Ctrl+A → Ctrl+V → Ctrl+S

### Запуск

1. В Admin Mode нажмите **▶ Запустить агента**
2. Выберите режим:
   - **Посты автора** — только посты Romeopro (~1-3 мин)
   - **Последние 10 стр.** — последние ~200 постов (~3-5 мин)
   - **Все страницы** — полный архив (~20-40 мин)
3. Агент откроет вкладку форума и будет автоматически переходить по страницам
4. По завершении данные автоматически загрузятся в GitHub
5. Через ~1 минуту сайт обновится

---

## Структура проекта

```
romeoprotracker/
├── data/
│   ├── posts.json      ← список постов (обновляется агентом)
│   ├── meta.json       ← метаданные марафона (БР, статус, хроника)
│   └── avatars.json    ← аватарки в base64
├── src/
│   ├── App.jsx         ← главный компонент
│   ├── storage.js      ← работа с GitHub API
│   ├── userscript.js   ← код Tampermonkey-скрипта
│   └── main.jsx        ← точка входа React
├── public/
│   └── favicon.svg
├── .github/workflows/
│   └── deploy.yml      ← автодеплой на GitHub Pages
├── index.html
├── package.json
└── vite.config.js
```

## Смена пароля администратора

В `src/App.jsx` найдите строку:
```js
const ADMIN_KEY = 'romeo2026';
```
Замените на свой пароль.
