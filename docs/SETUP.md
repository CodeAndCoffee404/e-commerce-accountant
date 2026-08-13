# Настройка окружений

Три окружения: **local** (ваша машина), **preview** (ветка `dev` на Vercel), **production** (ветка `main`).

Порядок важен: сначала Vercel, потому что адреса деплоев нужны для настройки Google OAuth.

---

## 0. GitHub — готово

Репозиторий `git@github.com:all1son4/e-commerce-accountant.git`, ветки `main` и `dev` запушены.

---

## 1. Vercel: проект, база Neon и хранилище — одним потоком

### 1.1. Импорт проекта

1. https://vercel.com/new
2. **Import Git Repository** → `all1son4/e-commerce-accountant` → **Import**.
   Если репозитория нет в списке — **Adjust GitHub App Permissions** и дайте доступ.
3. Framework Preset определится как **Next.js**. Ничего не меняйте, нажмите **Deploy**.
4. **Первый деплой упадёт** — переменных окружения ещё нет. Это ожидаемо, идём дальше.

После импорта запишите два адреса, они понадобятся в шаге 2:

```
production: https://<project>.vercel.app
preview:    https://<project>-git-dev-<team>.vercel.app
```

Точный preview-адрес появится после первого деплоя ветки `dev`
(**Deployments** → фильтр по ветке `dev`). Он стабильный и не меняется между деплоями —
именно поэтому мы работаем через ветку, а не через случайные preview-ссылки.

### 1.2. База данных Neon — прод

Neon заводится прямо из Vercel, отдельный аккаунт в Neon не нужен.

1. В проекте: вкладка **Storage** → **Create Database**.
2. В маркетплейсе выберите **Neon** → **Continue**.
3. Параметры:
   - Database Name: `ea-prod`
   - Region: **Frankfurt (eu-central-1)** — данные покупателей европейские, держим их в ЕС
   - Plan: Free на старте достаточно
4. **Connect to Project** → выберите проект и отметьте **только Production**.

Vercel сам добавит в проект переменные `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PGHOST` и прочие.
Нам нужна только `DATABASE_URL` — она уже пулированная, то что нужно.

### 1.3. База данных Neon — dev

Повторите шаг 1.2 ещё раз:

- Database Name: `ea-dev`
- Region: тот же Frankfurt
- **Connect to Project** → отметьте **Preview** и **Development**, но **не Production**.

> **Если Vercel ругается на конфликт имён переменных.** Обе базы хотят
> назваться `DATABASE_URL`. Поскольку они привязаны к разным окружениям,
> конфликта по сути нет, но интерфейс иногда предупреждает. Тогда задайте
> второй базе префикс, например `DEV_`, а потом в **Settings → Environment
> Variables** вручную добавьте `DATABASE_URL` для Preview и Development
> со значением из `DEV_DATABASE_URL`.

### 1.4. Хранилище файлов

1. **Storage** → **Create Database** → **Blob**.
2. Name: `ea-files`, регион Frankfurt.
3. **Connect to Project** → отметьте **все три** окружения.

Vercel добавит `BLOB_READ_WRITE_TOKEN`.

> Одного стора хватит на оба окружения: ключи объектов будут начинаться
> с `prod/` и `preview/`. Разделять есть смысл позже, когда появятся
> реальные данные клиента.

### 1.5. Переменные, которые Vercel не добавит сам

**Settings → Environment Variables**. Для каждой переменной отмечайте, в каких окружениях она действует.

| Переменная | Production | Preview + Development |
|---|---|---|
| `AUTH_SECRET` | `vGiarAVa++BFCBUZGr+9GJevh4+FQz+t6+txZg26gRQ=` | `8gXf/HZ7HLfEOn4WtnY+1QXN6pq1h20DriY5MfJ1QNE=` |
| `ENCRYPTION_KEY` | `33b85fe1c87c8027de2c4a90faba3bdac57487a68b2e336f38afce988c3ed4b4` | `a0bf235a5763c5b45d8fb6f2c9ff43b59140250bec34b672a67c3bb3719d4db7` |
| `GOOGLE_CLIENT_ID` | из шага 2 | то же значение |
| `GOOGLE_CLIENT_SECRET` | из шага 2 | то же значение |

> `ENCRYPTION_KEY` для production менять нельзя после того, как в базе появятся
> зашифрованные refresh-токены Google — старые записи перестанут читаться.

### 1.6. Ветка для продакшена

**Settings → Git → Production Branch** — должно стоять `main`.
Тогда `main` уезжает в прод, а `dev` автоматически даёт preview по стабильному адресу.

---

## 2. Google Cloud — вход в приложение

1. https://console.cloud.google.com → **Select a project** → **New Project**,
   имя `E-commerce Accountant`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** (для обычного Gmail) или **Internal** (если Google Workspace)
   - App name: `E-commerce Accountant`, support email — ваш
   - Scopes: ничего не добавляйте, базовые `email` и `profile` подставятся сами
   - **Test users**: добавьте свой email и email бухгалтера клиента

   > Приложение останется в статусе **Testing**. Войти смогут только
   > перечисленные тестовые пользователи — для MVP этого достаточно,
   > проходить верификацию в Google не нужно.

3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**, Name: `web`
   - **Authorized redirect URIs** — добавьте все три, подставив адреса из шага 1.1:

     ```
     http://localhost:3000/api/auth/callback/google
     https://<project>-git-dev-<team>.vercel.app/api/auth/callback/google
     https://<project>.vercel.app/api/auth/callback/google
     ```

     Адрес должен совпадать посимвольно, иначе Google вернёт `redirect_uri_mismatch`.

4. Скопируйте **Client ID** и **Client secret**.

> Доступ к Google Drive (скоуп `drive.file`) добавим на этапе 5 в этом же
> OAuth-клиенте. Он несенситивный, верификация приложения не потребуется.

---

## 3. Что прислать мне

| Что | Откуда | Зачем |
|---|---|---|
| `DATABASE_URL` от `ea-dev` | Vercel → Storage → `ea-dev` → **Connect** / `.env.local` кнопка | накатить миграции и проверить подключение локально |
| `GOOGLE_CLIENT_ID` | шаг 2.4 | настроить вход |
| `GOOGLE_CLIENT_SECRET` | шаг 2.4 | настроить вход |
| preview- и production-адреса | шаг 1.1 | проверить деплой |

Prod-строку подключения присылать не нужно — она живёт только в Vercel.
Blob-токен тоже не нужен: он понадобится на этапе 1, к тому моменту Vercel уже подставит его сам.

> Быстрый способ достать переменные окружения из Vercel к себе:
> `npx vercel link` и затем `npx vercel env pull .env.local` —
> подтянет весь набор для Development.

---

## 4. Локальная разработка

`.env.local` уже создан, `AUTH_SECRET` и `ENCRYPTION_KEY` в нём заполнены.
Осталось вписать `DATABASE_URL`, `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

```bash
npm run dev            # http://localhost:3000
npm run db:migrate     # накатить миграции
npm run db:studio      # посмотреть данные
npm test               # тесты
npm run typecheck      # типы
```
