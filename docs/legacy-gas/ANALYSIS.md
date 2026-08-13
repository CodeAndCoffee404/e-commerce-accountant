# Разбор legacy Google Apps Script

Анализ по состоянию на 2026-08-13. Источник: `docs/legacy-gas/scripts` (13 файлов, ~14k строк) и
`docs/legacy-gas/exported-reports` (117 файлов, входные и выходные отчёты за 2025–2026).

---

## 1. Что это за система

Бухгалтерский конвейер для e-commerce продавца (бренд Geyser), торгующего на:

| Канал | Страны/маркетплейсы |
|---|---|
| Amazon | ES, IT, FR, DE, UK, SE, PL, NL, IE, BE |
| Allegro | PL (+ продажи в CZ, SK, HU через OSS) |
| Cdiscount | FR |
| Shopify (собственный магазин) | ЕС + GB, отгрузка из ES |

Задача системы: принять «сырые» выгрузки из этих каналов, распознать их, сложить в Google Drive,
и по требованию собрать из них производные отчёты для НДС-отчётности (REGULAR / OSS) и для
выставления счетов в Zoho Books.

Юрлица и VAT-номера, зашитые в код:

```
EE102013089   Эстония — используется как OSS VAT number
ESN0531416F   Испания
DE329037549   Германия
CZ685219093   Чехия
PL5263307678  Польша
FR23888800463 Франция
IT00260459995 Италия
```

---

## 2. Структура: это ДВА проекта Apps Script, а не один

В папке `scripts` лежат файлы двух разных наборов — оба объявляют `onOpen`, а значит физически
не могли работать как один проект с двумя меню.

### Проект A — «Report Automation» (основной, 11 файлов)

`Menu.gs`, `UploadService.gs`, `Classifier.gs`, `Code.gs`,
`Report_SalesReportByCurrency.gs`, `OffAmazonSales.gs`,
`Report_AmazonInvoiceForZoho.gs`, `Report_AmazonInvoiceForZoho_config.gs`,
`UI_ReportUpload.html`, `UI_ReportGenerator.html`.

Привязан к таблице `1BUEIzz0PTPhm1HMKqMAf-I1hItL2ToH-5Qr0HVisGYU`.
Меню: **Report Automation → Upload raw report / Generate report**.

### Проект B — «Amazon VAT» (3 файла, неполный)

`Main.gs`, `VatDataContext.gs`, `ExceptionsSheet.gs`.
Меню: **Amazon VAT → Загрузить VAT Transaction Report**.

**Проект B выгружен не полностью.** `Main.gs` вызывает три функции, которых нет ни в одном файле:

```
createRawSheet()      — отсутствует
createRegularSheet()  — отсутствует
createOssSheet()      — отсутствует
```

Это, судя по всему, `RawSheet.gs`, `RegularSheet.gs`, `OssSheet.gs`. **Именно там лежит ядро
логики НДС-отчётности** (разделение REGULAR / UNION-OSS и построение сводок). Без них
восстановить эту часть по коду невозможно.

> Открытый вопрос: точно ли это два разных Apps Script проекта, или один, где `onOpen` затирается?
> Нужно проверить в редакторе.

---

## 3. Конвейер — общая картина

```
                 ┌──────────────────────────────────────────────┐
   Пользователь  │  Google Sheets «Report Automation database»   │
   вручную       │  ├── лист "Raw report database"  (реестр)     │
   выгружает     │  └── лист "Report log"           (журнал)     │
   отчёты        └──────────────────────────────────────────────┘
   из кабинетов                    │                    │
        │                          │                    │
        ▼                          ▼                    ▼
  ┌───────────────┐        ┌───────────────┐    ┌───────────────┐
  │ ЭТАП 1        │        │  Google Drive │    │ ЭТАП 2        │
  │ Upload raw    │───────▶│  16 папок     │───▶│ Generate      │
  │ report        │        │  (по типам)   │    │ report        │
  └───────────────┘        └───────────────┘    └───────────────┘
   классификация            оригинал + копия     3 генератора →
   + определение            в виде Google        новая папка
   периода                  Sheet (всё текст)    с результатом
```

Никакой автоматизации входа: файлы человек скачивает руками из Amazon Seller Central,
Allegro, Cdiscount и Shopify и загружает через диалог. API маркетплейсов не используются вообще.

---

## 4. Этап 1 — Upload raw report (`UploadService.gs` + `Classifier.gs`)

### 4.1. Приём файла

- Диалог читает файл в браузере, кодирует в base64, отправляет в `processUploadedFile()`.
- Ограничения: расширения `csv` / `xls` / `xlsx`, ≤ 20 МБ, ≤ 10 000 000 ячеек.
- CSV разбирается в Apps Script: автоопределение разделителя (`,` `;` `\t` `|`) по «стабильности»
  числа колонок, декодирование UTF-8 с фолбэком на Windows-1252, снятие BOM.
- XLS/XLSX конвертируется во временный Google Sheet через Advanced Drive Service.
  Требование: **ровно один лист** в книге.

### 4.2. Классификация (`classifyReport`)

Тип определяется по набору обязательных заголовков. Порядок и позиция колонок не важны,
регистр игнорируется.

| Тип | Строка заголовков | Признак |
|---|---|---|
| Amazon VAT transaction report | 0 | `UNIQUE_ACCOUNT_IDENTIFIER`, `ACTIVITY_PERIOD`, `SALES_CHANNEL`, `MARKETPLACE`, `PROGRAM_TYPE`, `TRANSACTION_TYPE` |
| Allegro sales report | 0 | `data`, `data zaksięgowania`, `identyfikator`, `operacja`, `operator` |
| Cdiscount sales report | **2** | `Sales channel`, `Shop Id`, `Invoice/Refund Id`, `Accounting date` |
| Geyser shopify sales report | 0 | `Name`, `Email`, `Financial Status`, `Paid at`, `Fulfillment Status`, `Created at` |

Отдельное семейство — **Amazon Monthly Transaction report**. У него заголовок «плавает»
(до 20 строк преамбулы), и он локализован. Поэтому заведены 9 языковых профилей заголовков
(ES / IT / FR / FR_ALT / DE / SE / PL / NL / EN), а страна определяется по значению домена
в колонке marketplace:

```
amazon.es → ES   amazon.it → IT   amazon.fr → FR   amazon.de → DE
amazon.co.uk → UK  amazon.se → SE  amazon.pl → PL  amazon.nl → NL
amazon.ie → IE   amazon.com.be → BE
```

Если тип не распознан — файл уходит в папку `Undefined` с именем `undefined - <timestamp>`.

### 4.3. Определение периода

Период — строка вида `2026.07 July` (месяц) или `2026.Q3` (полный квартал). Правила:

- **Amazon VAT** — из колонки `ACTIVITY_PERIOD` (формат `2026-Jul`), только строки `SALES_CHANNEL = AFN`.
- **Allegro** — из `data`, формат `dd.MM.yyyy HH:mm`.
- **Cdiscount** — из `Accounting date`, формат `yyyy-MM-dd`.
- **Shopify** — из `Created at`, формат `yyyy-MM-dd HH:mm:ss +HHMM`.
- **Amazon Monthly** — **из имени файла**, регулярка `^(\d{4})(Jan|Feb|…|Dec)`, например `2026Jul…`.

Если в файле уникальных месяцев больше одного, допускается только ровно 3 месяца одного
календарного квартала — иначе отказ (`INVALID_NUMBER_OF_MONTHS` / `INCOMPLETE_QUARTER`).

### 4.4. Сохранение

- Имя: `<Type> - <Period>`, например `Allegro sales report - 2026.07 July`.
- Папка назначения — жёстко зашитый Drive folder ID для каждого из 15 типов.
- Создаётся **две** сущности: оригинальный файл и Google Sheet с листом `Raw data`,
  в который **все значения записываются как текст** (`setNumberFormat("@")`).
- Строка в листе `Raw report database`: `Type | Period | Csv | Google sheet`
  (последние две — rich-text ссылки).

Версионирование различается по типам:

- Обычные типы: повторная загрузка того же Type+Period **заменяет** запись,
  старые файлы уезжают в корзину.
- Amazon Monthly Transaction report: **сохраняются все версии**, вторая и последующие
  получают в имени timestamp. Генератор потом берёт самую свежую строку.

---

## 5. Этап 2 — Generate report (`Code.gs`)

Общая инфраструктура: диалог отдаёт список типов отчётов и список доступных периодов
(уникальные `Period` из реестра). Далее:

1. `LockService` — глобальная блокировка на 30 с (один отчёт за раз).
2. Поиск исходников в `Raw report database` по Type + Period. Дубликат = ошибка
   (кроме Amazon Monthly, где берётся последняя версия).
3. Создание папки `<Label> - <Period>` в `1tMBitNk5fqaXr3qqOuUb-cjYc3AyMIlL`.
4. Вызов генератора.
5. Запись в лист `Report log`: `Report type | Period | Link`.
6. При любой ошибке — созданная папка удаляется целиком (rollback).

### 5.1. Генератор «Sales report by currency»

Вход: Amazon VAT transaction report. Выход: по одной Google-таблице на каждую валюту
из `TRANSACTION_CURRENCY_CODE` (фактически EUR, GBP, PLN, SEK).

Логика элементарная: строки распределяются по валюте as-is, колонка
`TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL` приводится к числу, под данными добавляется строка с
суммой. Плюс косметика — заливка колонок (`#00E5FF`, `#FF8A65`), итог 24 кеглем на жёлтом.

### 5.2. Генератор «Off-Amazon Sales»

Вход: Allegro + Cdiscount + Shopify за один период (**все три обязательны**).
Выход: одна книга с 4 листами — нормализованный `off-amazon sales` и три «сырых» листа
каналов (Allegro / Cdiscount / Shopify).

Целевая схема из 13 колонок:

```
Sales channel | transaction date | transaction type | currency | VAT rate |
VAT amount | Net amount | Total | departure country | arrival country |
seller VAT number | buyer VAT number | TAX_REPORTING_SCHEME
```

**Это ключевая бизнес-логика проекта.** Правила по каналам:

#### Allegro

- Берутся только строки с непустым `kupujący` (остальное — комиссии Allegro, отбрасывается).
- `operacja`: `wpłata` → `B2C SALE`, `zwrot` → `REFUND`. Любое другое значение — падение с ошибкой.
- Валюта определяется по **суффиксу в строке суммы** `kwota` (`zł` / `Kč` / `€` / `Ft`).
  Отсюда же выводится всё остальное:

| Валюта | Страна получения | Ставка | Схема | Seller VAT |
|---|---|---|---|---|
| PLN | PL | 23 % | REGULAR | PL5263307678 |
| CZK | CZ | 21 % | UNION-OSS | EE102013089 |
| EUR | SK | 20 % | UNION-OSS | EE102013089 |
| HUF | HU | 27 % | UNION-OSS | EE102013089 |

- Страна отправления всегда `PL`.
- Сумма из отчёта — **брутто**: `VAT = Total × r / (1 + r)`, `Net = Total − VAT`.
- Для REFUND знак принудительно отрицательный.

> Обратите внимание: соответствие «EUR → Словакия» — это допущение, что все евровые продажи
> на Allegro идут в SK. Если появится другая евро-страна, отчёт молча посчитает её как SK.

#### Cdiscount

- Берутся только `Invoice type` = `Vente` → `B2C SALE` и `Remboursement client` → `REFUND`.
  Всё остальное (`Abonnement`, `Avoir de commission`, `Avoir réserve de garantie` и т.п.) — пропуск.
- Константы: EUR, ставка 20 %, отправление FR, получение FR, `FR23888800463`, схема REGULAR.
- `VAT = Total × 0.2 / 1.2`, `Net = Total − VAT`. Собственная колонка `VAT amount` в отчёте
  Cdiscount равна нулю и игнорируется.

#### Shopify

- Исключаются строки `Source = shopify_draft_order`.
- **Все строки со страной получения CH пропускаются** (явное требование ТЗ).
- Страна получения: `Shipping Country`, иначе `Billing Country`. `UK` нормализуется в `GB`.
- Страна отправления всегда `ES`.
- Схема: `arrival == ES` → REGULAR (`ESN0531416F`), иначе UNION-OSS (`EE102013089`).
- Ставка НДС парсится из текста колонки `Tax 1 Name` (ищется `NN%`).
  - GB без ставки → принудительно 20 %.
  - Ставку определить не удалось → ячейка остаётся пустой и **подсвечивается жёлтым**
    (`#fff2cc`) для ручной доработки.
- Сумма НДС берётся из колонки `Taxes` как есть. Исключение: для GB, если `Taxes = 0`,
  а ставка есть — НДС досчитывается из `Total` как из брутто.

### 5.3. Генератор «Amazon invoice for Zoho»

Вход: Amazon Monthly Transaction report по **всем 10 странам** за один месяц
(квартал запрещён; отсутствие хотя бы одной страны — отказ с перечислением недостающих).
Выход: книга с основным листом `Amazon invoice for Zoho` + 10 листов по странам.

Алгоритм:

1. Для каждой страны копируется её отчёт на отдельный лист, при этом остаются только строки, где:
   - колонка C (`Typ` / `Tipo` / `Type`…) равна локализованному «Заказ»
     (`Pedido`, `Ordine`, `Commande`, `Bestellung`, `Order`, `Zamówienie`, `Bestelling`);
   - `Product Sales` после округления до 2 знаков ≠ 0.
2. К листу добавляется колонка `Unit Price` с формулой `=RC[x]/RC[y]`
   (Product Sales ÷ Quantity). Формула намеренно без `ROUND`/`IFERROR`/запятых, чтобы не
   зависеть от локали файла.
3. Строки группируются по ключу **SKU + Unit Price**, количества суммируются.
4. Amazon SKU транслируется в номенклатуру Zoho (8 соответствий), 7 SKU полностью исключаются.
5. Формируется строка счёта:

| Поле | Правило |
|---|---|
| Invoice Date | последний календарный день месяца |
| Invoice Number | `INV-Amz <CC>-<MM>.<YY>` → `INV-Amz DE-07.26` |
| Customer Name | `Amazon <CC>` |
| Currency Code | PL→PLN, UK→GBP, SE→SEK, остальные→EUR |
| Exchange Rate | `GOOGLEFINANCE("CURRENCY:xxxEUR")` на момент генерации |
| Item Name / SKU | из таблицы соответствий |
| Quantity | сумма по группе |
| Item Price | Unit Price группы |
| Account | `Amazon Sales <CC>` |

---

## 6. Проект B — обработка Amazon VAT transaction report

`Main.gs` принимает CSV и создаёт до четырёх листов: **Raw**, **Regular**, **OSS**, **Exceptions**
(пользователь выбирает чекбоксами, что создавать).

`VatDataContext.gs` — общий слой подготовки данных. Из 95 колонок отчёта вытягивает 9 значимых:

```
TAX_REPORTING_SCHEME            TRANSACTION_SELLER_VAT_NUMBER
SALES_CHANNEL                   TAXABLE_JURISDICTION
TRANSACTION_TYPE                TRANSACTION_CURRENCY_CODE
TAX_COLLECTION_RESPONSIBILITY   TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL
                                PRICE_OF_ITEMS_VAT_RATE_PERCENT
```

`ExceptionsSheet.gs` — «лист проблем». Строки, которые **никогда** не считаются исключением
(отбрасываются молча):

- `SALES_CHANNEL = AMAZON_FEE`
- `TRANSACTION_TYPE = FC_TRANSFER` (перемещения между складами)
- `TRANSACTION_TYPE = INBOUND`
- пустая `TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL`
- `TAX_COLLECTION_RESPONSIBILITY = MARKETPLACE` (НДС платит Amazon)

Остальные попадают в Exceptions с причиной, если:

- схема не `REGULAR` и не `UNION-OSS` (в реальных данных встречаются `UK_VOEC-IMPORT`, `CH_VOEC`, пустая);
- для REGULAR: пустой `TRANSACTION_SELLER_VAT_NUMBER`, нечисловая сумма, нечисловая или ≤ −1 ставка;
- для UNION-OSS: пустая `TAXABLE_JURISDICTION` + те же проверки суммы и ставки.

Логика самих Regular и OSS листов — **утеряна** (см. §2).

### Что в реальных данных (июль 2026, 4188 строк)

```
TAX_REPORTING_SCHEME:  REGULAR 2137 | UNION-OSS 1331 | (пусто) 672 | UK_VOEC-IMPORT 39 | CH_VOEC 9
SALES_CHANNEL:         AFN 4175 | AMAZON_FEE 13
TRANSACTION_TYPE:      SALE 3275 | FC_TRANSFER 495 | REFUND 241 | RETURN 162 | INVOICE 7 | CREDIT_NOTE 6 | INBOUND 2
TAX_COLLECTION_RESP.:  SELLER 3468 | (пусто) 672 | MARKETPLACE 48
Юрисдикции:            FR 1245 | ES 909 | IT 901 | DE 325 | BE 31 | PT 30 | SE 24 | PL 20 | AT 14 | NL 8 | LU 4
```

То есть примерно 16 % строк (672) имеют пустую схему — это FC_TRANSFER и подобные, и их надо
корректно отсеивать.

---

## 7. Найденные проблемы

### 🔴 Критично: Unit Price = 0 в 8 странах из 10

`UploadService.writeValuesAsText_()` записывает все значения в Google Sheet как **текст**.
В локализованных отчётах Amazon (DE, ES, IT, FR, PL, SE, NL, BE) десятичный разделитель —
запятая, поэтому `Product Sales` хранится строкой `"25,13"`. Формула `=N2/G2`
на текстовой ячейке даёт не число, и `Unit Price` схлопывается в 0.

Проверено на реальном выходе `Amazon invoice for Zoho - 2026.07 July`:

```
Всего строк счёта:  58
Item Price = 0.00:  50   ← DE, ES, IT, FR, PL, SE, NL, BE
Item Price ≠ 0:      8   ← только UK и IE (точка как разделитель)
```

Это значит, что счета в Zoho за все не-англоязычные маркетплейсы уходят с нулевой ценой позиции.
**Требует подтверждения у вас: знали ли вы об этом, и как компенсировали.**

### 🟠 Экспортированный код не совпадает с тем, что породило отчёты

В `OffAmazonSales.gs` для Cdiscount написано `total = Math.abs(grossAmount)` — то есть возвраты
должны выходить **положительными**. В реальном файле `Off-Amazon Sales - 2026.07 July.xlsx`
возврат записан как `-29.90`. Исходник Cdiscount содержит `(29.90)`.

Вывод: либо в редакторе лежит не та версия, что генерировала отчёты, либо отчёты старые.
Нужно свериться перед тем, как переносить правило.

### 🟠 Курс валют берётся на момент генерации

`GOOGLEFINANCE("CURRENCY:GBPEUR")` возвращает курс «сейчас», а не на дату счёта.
Перегенерация того же периода завтра даст другие суммы — отчёт невоспроизводим,
и с точки зрения налоговой это спорно (обычно нужен курс ЕЦБ на дату документа
или на последний день месяца).

### 🟡 Всё захардкожено в коде

- 2 ID таблиц, 16 ID папок Drive;
- 7 VAT-номеров;
- ставки НДС по странам (23/21/20/27 %);
- соответствия SKU и список игнорируемых SKU;
- список стран, локализованные названия «Заказ», словари заголовков.

Любое изменение ставки НДС, добавление страны или SKU = правка кода разработчиком.

### 🟡 Google Sheets в роли базы данных

- Нет транзакций: между записью в реестр и удалением старых файлов возможно рассогласование
  (код это частично осознаёт — есть `cleanupWarning`).
- Дубликат Type+Period — это ошибка, которую человек чинит руками в таблице.
- Поиск строки — линейный проход по `getDisplayValues()` всего листа.
- Нет истории изменений, нет привязки строки отчёта к исходной транзакции.

### 🟡 Нет идемпотентности и дедупликации на уровне транзакций

Система оперирует файлами, а не транзакциями. Если один и тот же заказ попал в две выгрузки —
он посчитается дважды, и обнаружить это нечем. Нет уникального ключа транзакции.

### 🟡 Разбор чисел дублируется 4 раза

`convertVatNumber_`, `parseSalesReportAmount_`, `parseOffAmazonNumber_`
(+ `parseOffAmazonCdiscountNumber_`, `parseOffAmazonAllegroAmount_`),
`parseAmazonInvoiceAggregationNumber_` — пять почти одинаковых функций с чуть разным поведением
на краевых случаях. Классический источник расхождений в цифрах.

### 🟡 Определение периода Amazon Monthly по имени файла

Регулярка `^(\d{4})(Jan|…)` по исходному имени. Переименовал файл при скачивании — отчёт уедет
в `Undefined`.

### 🟡 Exceptions — тупик

Строки с проблемами выписываются в отдельный лист, но механизма «исправить и переобработать» нет.
Что с ними делает бухгалтер дальше — из кода не видно.

### 🟡 Технические потолки Apps Script

6 минут на выполнение, 20 МБ на файл, 10 млн ячеек, блокировка «один отчёт за раз».
Отчёт по 10 странам с копированием всех строк на листы + формулы + `flush()` — это уже близко к
границе. `Amazon VAT transaction report` за квартал — 12k+ строк × 95 колонок.

---

## 8. Инвентарь фактических данных

```
docs/legacy-gas/exported-reports/Report Automation/
├── Amazon VAT transaction report/          2026.06, 2026.07, 2026.Q2      (~4200 строк/мес, 95 колонок)
├── Amazon Monthly Transaction report ×10/  ES,IT,FR,DE,UK,SE,PL,NL,IE,BE  (2026.02–2026.07, 29 колонок)
├── Allegro sales report/                   2025.01, 2026.01–2026.07       (11 колонок)
├── Cdiscount sales report/                 2026.01–2026.07                (14 колонок, заголовок в строке 3)
├── Geyser shopify sales report/            2026.01–2026.07                (70+ колонок)
├── Reports/                                 ← результаты работы генераторов
│   ├── Amazon invoice for Zoho - 2026.05, 2026.07
│   ├── Off-Amazon Sales - 2026.01 … 2026.07
│   └── Sales report by currency - 2026.06, 2026.07 (EUR/GBP/PLN/SEK)
└── Undefined/                               пусто
```

Наличие пар «вход → выход» за одни и те же периоды — это **готовый набор для регрессионных тестов**:
новая система должна на тех же входах давать те же числа (с поправкой на найденные баги).

---

## 9. Что нужно уточнить у вас

1. **Отсутствующие файлы** `RawSheet.gs` / `RegularSheet.gs` / `OssSheet.gs` — есть ли они
   где-то ещё? Без них логика Regular/OSS восстанавливается только с ваших слов.
2. **Баг с Unit Price = 0** — известен? Счета в Zoho правились вручную?
3. **Cdiscount и знак возврата** — какая версия правильная: `+29.90` или `−29.90`?
4. **Курс валют** — на какую дату он должен браться по-хорошему?
5. **Что происходит с Exceptions** после выгрузки — кто и как их разбирает?
6. **Куда девается результат** — `Off-Amazon Sales` и `Sales report by currency` кто-то
   загружает в другую систему, или это финальный документ для бухгалтера?
7. **Amazon VAT ↔ Off-Amazon** — они потом сводятся в одну VAT-декларацию? Где это происходит?
8. **Zoho Books** — импорт CSV руками или через API?
