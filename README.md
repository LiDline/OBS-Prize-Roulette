# OBS-Prize-Roulette

Рулетка с выпадением призов по War Thunder для OBS-оверлея. Оверлей
показывает анимированную ленту призов, выбирает победителя с учетом весов из
конфига и может запускаться автоматически по донатам DonationAlerts.

## Запуск

Для проверки можно открыть `index.html` в браузере. В этом режиме будет
использован встроенный конфиг из страницы. Добавьте `index.html` в OBS как локальный файл.

Пример итога:

```text
file:///home/lidline/Документы/test/OBS-Prize-Roulette/index.html
```

Для работы с внешним `config.json` лучше запускать проект через локальный
статический сервер. Этот же URL можно добавить в OBS как Browser Source.

Пример обычной страницы:

```text
http://localhost:8000/
```

Пример страницы с debug-панелью для ручной симуляции доната:

```text
http://localhost:8000/?debug=1
```

## Настройка

### Общие настройки

Основные настройки лежат в `config.json`.

```jsonc
{
  "donationThreshold": 500,       // Минимальная сумма доната для запуска рулетки
  "spinDurationMs": 6000,         // Длительность вращения ленты
  "resultDisplayMs": 3000,        // Сколько показывать выпавший приз
  "closeDelayMs": 800,            // Задержка перед скрытием оверлея после звука закрытия
  "sounds": {
    "open": "assets/open.mp3",    // Звук появления рулетки
    "close": "assets/close.mp3"   // Звук закрытия рулетки
  },
  "sound": "assets/common.mp3",   // Общий звук результата
  "prizes": [                     // Список призов
    {
      "id": 1,
      "name": "150 золотых орлов", // Название приза; картинка ищется как uploads/<name>.png
      "weight": 0.636137866315001  // Вес приза (сумма всех === 1)
    }
  ]
}
```

### Изображения призов

Картинки лежат в `uploads` и должны быть в формате PNG. Имя файла должно
совпадать с `name` соответствующего приза:

```text
config.json: "name": "Wyvern"
uploads:     Wyvern.png
```

Перед запуском оверлей не сканирует папку `uploads` сам. Вместо этого он читает
готовый список файлов из `js/uploaded-images.js`. Этот файл генерируется
скриптом `generate-uploaded-images-manifest.js`.

Запуск скрипта:

```bash
node scripts/generate-uploaded-images-manifest.js
```

Запускайте скрипт каждый раз после добавления, удаления или переименования PNG в
`uploads`. Иначе оверлей может не увидеть новую картинку и покажет текстовое
название приза.

## DonationAlerts

Настройки DonationAlerts находятся в блоке `donationAlerts` внутри
`config.json`.

```json
{
  "donationAlerts": {
    "accessToken": "",
    "userId": "",
    "socketConnectionToken": "",
    "apiBaseUrl": "https://www.donationalerts.com/api/v1",
    "socketUrl": "wss://centrifugo.donationalerts.com/connection/websocket",
    "autoReconnect": true,
    "reconnectDelayMs": 5000
  }
}
```

Минимально нужен `accessToken`. Если `userId` и `socketConnectionToken` не
заполнены, приложение попробует получить их через DonationAlerts API.

Когда DonationAlerts присылает донат, сумма передается в `handleDonation`.
Рулетка запускается только если сумма больше или равна `donationThreshold`.

## Структура проекта

```text
OBS-Prize-Roulette/
|-- index.html                                # HTML-разметка оверлея, debug-панель и встроенный запасной конфиг
|-- style.css                                 # Визуальное оформление рулетки
|-- script.js                                 # Точка входа: инициализация, загрузка конфига, debug-панель, DonationAlerts
|-- config.json                               # Основной внешний конфиг призов, весов, таймингов, звуков и DonationAlerts
|-- js/
|   |-- config.js                             # Загрузка и объединение внешнего, встроенного и fallback-конфига
|   |-- debug.js                              # Логика debug-панели и ручной симуляции доната
|   |-- donation-alerts.js                    # DonationAlerts API/WebSocket и запуск рулетки по донату
|   |-- roulette.js                           # Выбор победителя, построение ленты, анимация и показ результата
|   |-- state.js                              # Общее состояние приложения
|   |-- uploaded-images.js                    # Сгенерированный список доступных PNG-картинок из uploads
|   `-- utils.js                              # Общие утилиты для CSS-значений, звуков и расчетов
|-- uploads/
|   `-- *.png                                 # Изображения призов; имя файла должно совпадать с name в config.json
|-- assets/
|   `-- *.mp3                                 # Звуки открытия, закрытия и результата
|-- scripts/
|   `-- generate-uploaded-images-manifest.js  # Проверка на наличие изображений
|-- tests/                                    # Тесты
|   |-- roulette.test.js
|   `-- uploaded-images-manifest.test.js
`-- README.md
```
