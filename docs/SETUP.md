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
4. Первый деплой пройдёт даже без переменных окружения: проверка env ленивая и
   срабатывает только на том запросе, которому переменная реально нужна.
   Приложение поднимется, но всё, что ходит в базу, начнёт отдавать ошибку —
   до шага 1.5 это нормально.

**Готово.** Оба окружения развёрнуты, адреса такие:

```
production  https://e-commerce-accountant.vercel.app
preview     https://e-commerce-accountant-git-dev-code-and-coffee1.vercel.app
```

Это **стабильные алиасы**, они не меняются между деплоями. Ссылка с хешем вида
`e-commerce-accountant-bxxnw5cjz-...` указывает на один конкретный деплой и
после следующего пуша станет неактуальной — для настройки OAuth она не годится.

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

> **Конфликт имён переменных.** Обе базы хотят назваться `DATABASE_URL`.
> Vercel не даёт занять имя дважды, даже если окружения разные. Поэтому у
> `ea-dev` стоит префикс `DEV_` — она отдаёт `DEV_DATABASE_URL` и
> `DEV_DATABASE_URL_UNPOOLED` в Preview и Development, а свободное имя
> `DATABASE_URL` достаётся `ea-prod` в Production.
>
> Дублировать значение руками не нужно: `src/lib/env.ts` читает
> `DATABASE_URL`, а если его нет — `DEV_DATABASE_URL`. В каждом окружении
> присутствует ровно один из двух. Ручная копия рассинхронизировалась бы
> при первой же смене пароля в Neon.

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

| Переменная | Production | Preview | Development |
|---|---|---|---|
| `AUTH_SECRET` | своё значение | своё значение | своё значение |
| `ENCRYPTION_KEY` | своё значение | своё значение | своё значение |
| `GOOGLE_CLIENT_ID` | одно и то же значение из шага 2 | | |
| `GOOGLE_CLIENT_SECRET` | одно и то же значение из шага 2 | | |

Сами значения — в `docs/secrets.local.md`; этот файл в `.gitignore`, потому что
секретам не место в репозитории. `AUTH_SECRET` и `ENCRYPTION_KEY` в каждом
окружении свои: одинаковый `AUTH_SECRET` сделал бы сессионную куку из preview
действительной и в проде, а одинаковый `ENCRYPTION_KEY` — превратил бы доступ
к preview в доступ к боевым refresh-токенам Google.

Раскладывает их скрипт, см. раздел «Применение переменных» ниже.

> `ENCRYPTION_KEY` для production менять нельзя после того, как в базе появятся
> зашифрованные refresh-токены Google — старые записи перестанут читаться.

### 1.6. Применение переменных

Руками кликать не нужно. Один раз войдите в CLI:

```bash
npx vercel login
```

Дальше всё делает скрипт — он привяжет проект, снесёт ручные копии
`DATABASE_URL` и `BLOB_READ_WRITE_TOKEN` (их отдают интеграции Neon и Blob),
и разложит секреты из `docs/secrets.local.md` по трём окружениям:

```bash
npm run env:sync -- --dry-run   # посмотреть, что будет сделано
npm run env:sync                # применить
```

Чтобы добавить переменную, впишите строку в таблицу `docs/secrets.local.md`
и прогоните скрипт снова. Значения для production и preview он помечает
Sensitive, для development — нет, иначе `vercel env pull` не сможет наполнить
локальный `.env.local`.

### 1.7. Ветка для продакшена

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
     https://e-commerce-accountant-git-dev-code-and-coffee1.vercel.app/api/auth/callback/google
     https://e-commerce-accountant.vercel.app/api/auth/callback/google
     ```

     Адрес должен совпадать посимвольно, иначе Google вернёт `redirect_uri_mismatch`.

4. Скопируйте **Client ID** и **Client secret**.

> Доступ к Google Drive (скоуп `drive.file`) добавим на этапе 5 в этом же
> OAuth-клиенте. Он несенситивный, верификация приложения не потребуется.

---

## 3. Что прислать мне

| Что | Как |
|---|---|
| доступ к Vercel CLI | `npx vercel login` — один раз, дальше всё делаю я |
| `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` | шаг 2.4, впишите строками в `docs/secrets.local.md` |

Больше ничего присылать не нужно. Строки подключения к базам я возьму сам через
`npx vercel env pull` — они уже лежат в Vercel и обе помечены не-Sensitive,
потому что их заводит интеграция Neon. Prod-строка при этом остаётся в
Production-окружении и локально не появляется.

Blob-токен тоже не нужен: он понадобится на этапе 1, к тому моменту Vercel уже подставит его сам.

---

## 4. Локальная разработка

`.env.local` наполняется из Vercel, руками его править не нужно:

```bash
npx vercel env pull .env.local
```

Придут `DEV_DATABASE_URL` (база `ea-dev`), `AUTH_SECRET`, `ENCRYPTION_KEY` и
ключи Google — всё в development-варианте.

```bash
npm run dev            # http://localhost:3000
npm run db:migrate     # накатить миграции
npm run db:studio      # посмотреть данные
npm test               # тесты
npm run typecheck      # типы
```
