# OBS-Prize-Roulette

Рулетка с выпадением призов по War Thunder для OBS-оверлея. Оверлей
показывает анимированную ленту призов, выбирает победителя с учетом весов из
конфига и может запускаться автоматически по донатам DonationAlerts.

Пример работы рулетки:

![alt text](frontend/image.png)

Звук рулетки: https://freesound.org/people/Squirrel_404/sounds/683048/

## Запуск

Запускайте рулетку через локальный Node-сервер.

### 1. Запустите сервер

```bash
node backend/server.js
```

Если все хорошо, в терминале появится такая строка:

```text
OBS Prize Roulette server: http://127.0.0.1:3000/
```

Терминал после этого не закрывайте. Пока он открыт, рулетка работает.

### 2. Откройте рулетку в браузере или OBS

В OBS добавьте источник `Браузер` / `Browser Source` и вставьте туда обычную
ссылку:

```text
http://127.0.0.1:3000/
```

Ссылка с debug-панелью, чтобы вручную проверить прокрутку без настоящего
доната:

```text
http://127.0.0.1:3000/?debug=1
```

### 3. DonationAlerts

Создать ID приложения можно [тут](https://www.donationalerts.com/application/clients). URL редиректа укажите `http://127.0.0.1:3000/` (либо свой из .env).

Когда откроете страницу рулетки, она попросит ранее созданное ID приложения. Вставьте ID, нажмите кнопку авторизации и разрешите доступ.

Сделать тестовый донат можно [тут](https://www.donationalerts.com/dashboard/activity-feed/donations).
Нажмите кнопку "Добавить сообщение".

## Настройка работы рулетки

### Общие настройки

Основные настройки лежат в `frontend/config.json`.

```jsonc
{
  "donationThreshold": 500,       // Сумма доната за одну прокрутку рулетки
  "spinDurationMs": 6000,         // Длительность вращения ленты
  "resultDisplayMs": 3000,        // Сколько показывать выпавший приз
  "closeDelayMs": 800,            // Задержка перед скрытием оверлея после результата
  "sound": "assets/test1234.mp3", // Звук смены карточки во время прокрутки
  "prizes": [                     // Список призов
    {
      "id": 1,
      "name": "150 золотых орлов", // Название приза; картинка ищется как uploads/<name>.png
      "weight": 0.636137866315001  // Вес приза (СУММА ВСЕХ ДОЛЖНА БЫТЬ === 1)
    }
  ]
}
```

### Изображения призов

Картинки лежат в `uploads` и должны быть в формате PNG. Имя файла должно
совпадать с `name` соответствующего приза:

```text
frontend/config.json: "name": "Wyvern"

uploads:              Wyvern.png
```

## DonationAlerts

Интеграция DonationAlerts находится на backend-стороне. Браузер проходит OAuth и
передает access token в `/api/donationalerts/token`, далее слушает локальные события
из `/api/donationalerts/events`.

Опциональные backend-настройки можно задать в `.env`:

```env
DONATIONALERTS_API_BASE_URL=https://www.donationalerts.com/api/v1
DONATIONALERTS_SOCKET_URL=wss://centrifugo.donationalerts.com/connection/websocket
DONATIONALERTS_REQUEST_TIMEOUT_MS=10000
```

Признак успешного подключения в консоли сервера:

```text
DonationAlerts channel subscribed: $alerts:donation_<userId>
```

## Структура проекта

```text
OBS-Prize-Roulette/
|-- frontend/                                 # Браузерная часть OBS-оверлея
|   |-- index.html                            # HTML-разметка оверлея и debug-панель
|   |-- style.css                             # Визуальное оформление рулетки
|   |-- script.js                             # Точка входа: инициализация, загрузка конфига, debug-панель, DonationAlerts
|   |-- config.json                           # Основной внешний конфиг призов, весов, таймингов, звуков и DonationAlerts
|   |-- js/
|   |   |-- config.js                         # Загрузка внешнего config.json и fallback-конфиг
|   |   |-- debug.js                          # Логика debug-панели и ручной симуляции доната
|   |   |-- donation-alerts.js                # OAuth-передача токена backend и локальные события донатов
|   |   |-- roulette.js                       # Выбор победителя, построение ленты, анимация и показ результата
|   |   |-- state.js                          # Общее состояние приложения
|   |   |-- uploaded-images.js                # Сгенерированный список доступных PNG-картинок из uploads
|   |   `-- utils.js                          # Общие утилиты для CSS-значений, звуков и расчетов
|   |-- assets/
|   |   `-- *.mp3                             # Звуки открытия, закрытия и результата
|   `-- tests/                                # Тесты браузерной логики
|-- backend/                                  # Node-сервер и серверные утилиты
|   |-- server.js                             # Точка входа сервера и публичные экспорты для тестов
|   |-- src/
|   |   |-- app.js                            # Создание HTTP-сервера, маршрутизация API и статики
|   |   |-- constants.js                      # Общие настройки по умолчанию
|   |   |-- donationalerts.js                 # DonationAlerts API, SSE-события и обработка socket-сообщений
|   |   |-- env.js                            # Чтение .env-файла
|   |   |-- http-response.js                  # JSON/text HTTP-ответы
|   |   |-- static.js                         # Раздача frontend и uploads
|   |   `-- websocket-client.js               # Минимальный WebSocket-клиент для DonationAlerts
|   |-- scripts/
|   |   `-- generate-uploaded-images-manifest.js
|   `-- tests/                                # Тесты сервера и backend-скриптов
|-- uploads/
|   `-- *.png                                 # Изображения призов; имя файла должно совпадать с name в config.json
`-- README.md
```
