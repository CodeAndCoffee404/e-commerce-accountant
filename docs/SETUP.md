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

Vercel добавит `BLOB_STORE_ID` и `BLOB_WEBHOOK_PUBLIC_KEY`. Статического
`BLOB_READ_WRITE_TOKEN` не будет, и это правильно: проект ходит в хранилище по
OIDC — деплой предъявляет `VERCEL_OIDC_TOKEN`, который Vercel выдаёт сам и
регулярно обновляет. Долгоживущего ключа от хранилища не существует, значит и
утечь нечему.

Загрузка с браузера идёт по presigned-ссылке (`handleUploadPresigned`), а не по
старой схеме с клиентским токеном: та требует именно статический ключ.

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
| `CRON_SECRET` | своё значение | своё значение | своё значение |

Сами значения — в `docs/secrets.local.md`; этот файл в `.gitignore`, потому что
секретам не место в репозитории. `AUTH_SECRET` и `ENCRYPTION_KEY` в каждом
окружении свои: одинаковый `AUTH_SECRET` сделал бы сессионную куку из preview
действительной и в проде, а одинаковый `ENCRYPTION_KEY` — превратил бы доступ
к preview в доступ к боевым refresh-токенам Google.

Раскладывает их скрипт, см. раздел «Применение переменных» ниже.

> `ENCRYPTION_KEY` для production менять нельзя после того, как в базе появятся
> зашифрованные refresh-токены Google — старые записи перестанут читаться.

`CRON_SECRET` — то, чем планировщик доказывает, что он планировщик. Vercel
присылает его заголовком `Authorization: Bearer` при каждом запуске крона, а
`/api/cron/daily` отклоняет всё остальное. Если переменная не задана, роут
отклоняет вообще всех: эндпоинт, который пишет строки, не должен открываться
миру из-за забытой переменной. Генерируется так же, как ключ шифрования:
`npm run generate:key`.

### 1.6. Применение переменных

Руками кликать не нужно. Один раз войдите в CLI:

```bash
npx vercel login
```

Дальше всё делает скрипт — он привяжет проект и разложит секреты из
`docs/secrets.local.md` по трём окружениям. Переменные интеграций Neon и Blob
он не трогает: однажды он их удалил, и прод остался без базы.

```bash
npm run env:sync -- --dry-run   # посмотреть, что будет сделано
npm run env:sync                # применить
```

Чтобы добавить переменную, впишите строки в таблицу `docs/secrets.local.md`
и прогоните скрипт снова. Значения для production и preview он помечает
Sensitive, для development — нет, иначе `vercel env pull` не сможет наполнить
локальный `.env.local`.

Строк должно быть три — по одной на каждое окружение, даже если значение
везде одинаковое. Vercel хранит одну запись сразу на несколько окружений и не
даёт снять с неё одно, поэтому скрипт удаляет переменную целиком и создаёт
заново. Если перечислить не все окружения, недостающие останутся без
значения — на этот случай скрипт останавливается с ошибкой.

### 1.7. Ветка для продакшена

**Settings → Git → Production Branch** — должно стоять `main`.
Тогда `main` уезжает в прод, а `dev` автоматически даёт preview по стабильному адресу.

### 1.8. Миграции накатываются при деплое

Переменные `ea-prod` помечены Sensitive и обратно не читаются, поэтому боевой
строки подключения нет ни у кого локально — и накатить миграции руками нельзя.
Их выполняет сборка: в `package.json` есть скрипт `vercel-build`, который
Vercel предпочитает обычному `build`.

```
"vercel-build": "drizzle-kit migrate && next build"
```

Vercel подставляет переменные в билд, включая Sensitive, так что prod-деплой
обновляет `ea-prod`, а preview-деплой — `ea-dev`. Повторный прогон ничего не
делает: применённые миграции записаны в таблицу `drizzle.__drizzle_migrations`.

Отсюда правило: **миграции должны быть совместимы со старым кодом**. Схема
меняется до того, как новая версия начнёт отвечать на запросы, и во время
переключения по базе ещё ходит предыдущая. Поэтому колонку сначала добавляют
и заполняют, а удаляют её отдельным деплоем — позже. Неудачная миграция валит
сборку, и код с несовпадающей схемой до прода не доезжает.

### 1.9. Кто может войти

Список допуска живёт в таблице `allowed_emails`, но заполнить её в проде
некому: строка подключения к `ea-prod` помечена Sensitive и не читается.
Поэтому есть `AUTH_BOOTSTRAP_EMAILS` — адреса Google через запятую, которым
вход разрешён без приглашения. Первый такой вход заводит арендатора `Geyser`
и делает вошедшего владельцем; дальше приглашения раздаются через таблицу.

Переменную ставит тот же `npm run env:sync` из `docs/secrets.local.md`.
Рычаг мощный, но не даёт лишнего: тот, кто может менять переменные окружения,
и так распоряжается всем деплоем.

### 1.10. Почта в коммитах должна быть настоящей

Vercel сверяет автора коммита с пользователем GitHub, у которого есть доступ
к проекту. Если `user.email` в git — не адрес почты (например, просто ник),
сопоставить не с кем, и деплой встаёт в состояние `BLOCKED` ещё до сборки:

```
readyStateReason: The Deployment was blocked because GitHub could not
                  associate the committer with a GitHub user.
seatBlock:        { blockCode: COMMIT_AUTHOR_REQUIRED }
```

В логах сборки при этом пусто — сборка не начиналась. В репозитории задан
адрес вида `<id>+<логин>@users.noreply.github.com`: GitHub всегда сопоставляет
его с аккаунтом, а личная почта при этом не попадает в публичную историю.

```bash
git config user.email "78477841+all1son4@users.noreply.github.com"
```

В `~/.gitconfig` до сих пор лежит `user.email all1son4` — он сломает так же
любой другой репозиторий. Поправить глобально стоит той же командой с `--global`.

---

## 2. Google Cloud — вход в приложение

1. https://console.cloud.google.com → **Select a project** → **New Project**,
   имя `E-commerce Accountant`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** (для обычного Gmail) или **Internal** (если Google Workspace)
   - App name: `E-commerce Accountant`, support email — ваш
   - Scopes: ничего не добавляйте, базовые `email` и `profile` подставятся сами
   - **Test users**: добавьте свой email и email бухгалтера клиента

   > **Publishing status → Publish app** (статус `In production`).
   >
   > Раньше здесь было написано, что для MVP хватит статуса **Testing**. Это
   > неверно, и вот почему. В статусе Testing Google, во-первых, пускает только
   > перечисленных тестовых пользователей — остальные видят
   > `Ошибка 403: access_denied` ещё до экрана согласия. Во-вторых, и это хуже,
   > **refresh-токен живёт 7 дней**. Подключённый Drive молча отваливался бы
   > каждую неделю, и никакая перезагрузка страницы этого не чинит.
   >
   > Верификацию проходить всё равно не нужно: приложение просит только
   > `email`, `profile` и `drive.file`, а это несенситивные скоупы. Publish
   > срабатывает сразу, ревью Google не требуется.

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

### 2.5. Доступ к Google Drive

Отчёты складываются в папку на Google Drive клиента. Нужны ещё три вещи в том
же проекте Google Cloud.

**Включите два API.** APIs & Services → **Enable APIs and Services**:

- **Google Drive API** — записывать файлы;
- **Google Picker API** — окно выбора папки.

**Добавьте адреса возврата** в тот же OAuth-клиент из шага 2.3:

```
http://localhost:3000/api/google/callback
https://e-commerce-accountant-git-dev-code-and-coffee1.vercel.app/api/google/callback
https://e-commerce-accountant.vercel.app/api/google/callback
```

Это отдельный маршрут от входа: доступ к диску запрашивается один раз и явно,
а не при каждом входе в приложение.

**Создайте ключ для Picker.** Credentials → Create Credentials → **API key**.
Ограничьте его: Application restrictions → **Websites**, перечислите три
адреса приложения; API restrictions → только **Google Picker API**. Значение
впишите в `docs/secrets.local.md` строкой `GOOGLE_PICKER_API_KEY` с окружением
`all` и прогоните `npm run env:sync`.

> Ключ Picker уезжает в браузер по своей природе — на то он и browser key.
> Ограничение по адресам и по API и есть его защита; секретом в обычном смысле
> он не является.

**Скоуп остаётся `drive.file`.** Приложение видит только те файлы, которые само
создало, и ту папку, которую клиент выбрал. Верификация в Google не нужна.

Отсюда же следует, почему папка выбирается через окно Google, а не вводом
идентификатора: `drive.file` не даёт доступа к уже существующей папке, пока
пользователь не укажет её явно. Введённый вручную идентификатор не несёт с
собой никакого разрешения.

---

## 3. Что прислать мне

| Что | Как |
|---|---|
| доступ к Vercel CLI | `npx vercel login` — один раз, дальше всё делаю я |
| `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` | шаг 2.4, впишите строками в `docs/secrets.local.md` |
| `AUTH_BOOTSTRAP_EMAILS` | адрес Google, которым будете входить — в ту же таблицу, затем `npm run env:sync` |
| `GOOGLE_PICKER_API_KEY` | шаг 2.5, в ту же таблицу с окружением `all` |

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
