# Настройка окружений

Что нужно завести вручную, прежде чем этап 0 можно будет закрыть.
Три окружения: **local** (ваша машина), **preview** (ветка `dev` на Vercel), **prod**.

---

## 1. GitHub — приватный репозиторий

1. https://github.com/new → имя `e-commerce-accountant`, **Private**.
2. **Не** отмечайте «Add a README», «.gitignore» и «license» — репозиторий должен быть пустым.
3. Скопируйте URL вида `git@github.com:<вы>/e-commerce-accountant.git`.

Пришлите URL — я подключу remote, сделаю первый коммит и создам ветку `dev`.

---

## 2. Neon — две базы

Заводим **два отдельных проекта**, как договорились.

1. https://console.neon.tech → **New Project**.
   - Name: `ea-prod`, Region: **EU (Frankfurt)** — данные клиента европейские, держим их в ЕС.
   - Postgres версия: последняя.
2. Повторите для второго проекта: Name `ea-dev`, тот же регион.
3. В каждом проекте: **Connection Details** → строка подключения.
   - Обязательно возьмите вариант с **Pooled connection** (в хосте есть `-pooler`).
   - Формат: `postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`

Нужны две строки: `DATABASE_URL` для prod и для dev.

> Для local можно указать строку от `ea-dev` — отдельная третья база не нужна,
> пока вы один разработчик.

---

## 3. Google Cloud — OAuth для входа

1. https://console.cloud.google.com → **New Project**, имя `E-commerce Accountant`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**, если у вас обычный Gmail; **Internal**, если Workspace.
   - App name: `E-commerce Accountant`, support email — ваш.
   - Scopes: пока ничего не добавляйте, базовые `email`/`profile` подставятся сами.
   - Test users: добавьте свой email и email бухгалтера клиента.
     Пока приложение в статусе Testing, войти смогут только они — этого достаточно.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `web`
   - **Authorized redirect URIs** — добавьте все три:
     ```
     http://localhost:3000/api/auth/callback/google
     https://<project>-git-dev-<team>.vercel.app/api/auth/callback/google
     https://<ваш-прод-домен>/api/auth/callback/google
     ```
     Точные адреса Vercel я пришлю после первого деплоя — второй и третий
     можно добавить позже, для локальной работы хватит первого.
4. Скопируйте **Client ID** и **Client secret**.

> Скоуп `drive.file` для выгрузки отчётов на Google Drive добавим на этапе 5.
> Он несенситивный, верификация приложения в Google не потребуется.

---

## 4. Vercel — проект, окружения и Blob

Делается **после** того, как код окажется в GitHub.

1. https://vercel.com/new → импортируйте репозиторий.
2. Framework Preset определится как Next.js — ничего менять не нужно, деплой пока
   упадёт из-за отсутствующих переменных, это нормально.
3. **Settings → Environment Variables** — заполните для каждого окружения.
   Vercel различает Production / Preview / Development; ставьте галочки соответственно.

   | Переменная | Production | Preview |
   |---|---|---|
   | `DATABASE_URL` | строка от `ea-prod` | строка от `ea-dev` |
   | `AUTH_SECRET` | см. ниже | см. ниже |
   | `ENCRYPTION_KEY` | см. ниже | см. ниже |
   | `GOOGLE_CLIENT_ID` | один и тот же | один и тот же |
   | `GOOGLE_CLIENT_SECRET` | один и тот же | один и тот же |
   | `BLOB_READ_WRITE_TOKEN` | подставится автоматически (шаг 5) | то же |

4. **Settings → Git → Production Branch**: оставьте `main`.
   Ветка `dev` будет автоматически давать preview со стабильным адресом
   `<project>-git-dev-<team>.vercel.app`.

---

## 5. Vercel Blob — хранилище файлов

1. В проекте: **Storage → Create Database → Blob**.
2. Name: `ea-files`, регион — Frankfurt.
3. **Connect to Project** → выберите проект и отметьте все три окружения.
   Vercel сам добавит `BLOB_READ_WRITE_TOKEN` в переменные.

> На старте одного стора хватит на оба окружения: ключи объектов будут
> начинаться с `prod/` и `preview/`. Разделять на два стора имеет смысл
> позже, когда появятся реальные данные клиента.

---

## 6. Сгенерированные секреты

`AUTH_SECRET` и `ENCRYPTION_KEY` уже созданы. Локальные лежат в `.env.local`,
для Vercel возьмите значения, которые я прислал в чате.

Сгенерировать новые при необходимости:

```bash
npx auth secret            # AUTH_SECRET
npm run generate:key       # ENCRYPTION_KEY
```

> `ENCRYPTION_KEY` менять нельзя после того, как в базе появятся
> зашифрованные refresh-токены Google — старые записи перестанут читаться.
> Ротация ключа — отдельная процедура, заложена версионным префиксом `v1:`.

---

## 7. Что прислать мне

1. URL GitHub-репозитория.
2. `DATABASE_URL` от `ea-dev` — чтобы я применил миграции и проверил подключение
   локально. Prod-строку присылать не нужно, её достаточно вписать в Vercel.
3. `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

Blob-токен мне не нужен: он понадобится на этапе 1, и к тому моменту
Vercel уже подставит его сам.
