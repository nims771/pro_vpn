# ProClient — свой VPN-клиент на основе Outline

Это форк официального клиента [Outline](https://github.com/Jigsaw-Code/outline-apps) (лицензия Apache 2.0).
Приложение работает так же, как Outline: вставляете ключ `ss://…` (или `ssconf://…`) от своего сервера Outline и нажимаете «Подключить». Весь трафик телефона идёт через сервер.

Одна кодовая база (Capacitor), два приложения: **Android** и **iOS**.

Что уже изменено по сравнению с Outline:

- название, ID приложения, App Group для iOS;
- иконка, сплэш-экран, логотипы, фирменный цвет в интерфейсе;
- слово «Outline» во всех переводах интерфейса (кроме экрана «О программе», где упоминается исходный проект);
- для релизной сборки больше не нужен Sentry (сбор ошибок выключен, пока вы сами не добавите `SENTRY_DSN`);
- своя сборка в GitHub Actions (`.github/workflows/build_app.yml`). Родные CI-сценарии Outline перенесены в `.github/workflows-upstream/`, чтобы не тратить ваши минуты.

---

## 1. Настроить под себя (5 минут)

Откройте `branding/brand.json`:

| Поле | Что это | Пример |
|---|---|---|
| `name` | Название под иконкой и в интерфейсе | `"FastVPN"` |
| `androidId` | ID приложения Android. Должен быть уникальным, после публикации **не меняется** | `"com.fastvpn.app"` |
| `iosId` | Bundle ID для iOS. Должен совпадать с зарегистрированным в Apple Developer | `"com.fastvpn.app"` |
| `appGroup` | App Group для iOS, обычно `group.` + iosId | `"group.com.fastvpn.app"` |
| `primaryColor` | Фирменный цвет (кнопки, ссылки, иконка) | `"#7C3AED"` |
| `backgroundColor` | Фон сплэш-экрана | `"#0B1220"` |
| `icon` | Своя иконка: путь к PNG 1024×1024 **относительно папки branding**. Пусто — нарисуется значок-щит в вашем цвете | `"my-icon.png"` |
| `appleTeamId` | Team ID из Apple Developer (10 символов). Нужен только для iOS | `"AB12CD34EF"` |
| `supportUrl` | Куда ведёт «Помощь» в меню. Пусто — сайт Outline | `"https://t.me/fastvpn_support"` |
| `getKeyUrl` | Ссылка «Создайте ключ на нашем сайте» в окне добавления ключа | `"https://t.me/fastvpn_bot"` |

Затем из корня проекта:

```bash
npm ci                              # один раз
python3 branding/rebrand.py --assets
```

Нужны Python 3 с Pillow (`pip install pillow`) и Node.js 22.
Скрипт можно запускать сколько угодно раз: поменяли название или цвет — запустили снова.
Флаг `--assets` пересобирает иконки во всех размерах для Android и iOS.

---

## 2. Android

### Вариант А: собрать в облаке GitHub (без Android Studio)

1. Создайте **приватный** репозиторий на GitHub и загрузите туда проект:
   ```bash
   git remote remove origin
   git remote add origin https://github.com/ВАШ_ЛОГИН/myvpn.git
   git push -u origin HEAD:main
   ```
2. Сборка запускается сама после каждого `git push` (или вручную: **Actions** → **Build app** → **Run workflow**).
3. Через ~15 минут APK появится в разделе **Releases** репозитория (сборка «Последняя сборка»). Его можно ставить на телефон: разрешите «установку из неизвестных источников».

Без ключа подписи собирается **debug-APK**. Он работает полностью, но поверх него нельзя поставить релизную версию (придётся удалить и поставить заново).

**Подписанный релиз** (для раздачи людям и для Google Play):

```bash
bash branding/make_keystore.sh
```

Затем в GitHub → Settings → Secrets and variables → Actions добавьте секреты:

- `ANDROID_KEY_STORE_CONTENTS` — содержимое `branding/release-keystore.base64`
- `ANDROID_KEY_STORE_PASSWORD` — пароль

После этого Actions будет собирать подписанные `.apk` и `.aab`.
⚠️ Сохраните `release-keystore.p12` и пароль. Если их потерять, обновить приложение у пользователей будет нельзя.

### Вариант Б: на своём компьютере

Нужно: Android Studio, JDK 21, Go 1.22+, Node.js 22.

```bash
npm ci
npm run action client/capacitor/build android        # debug-APK
# файл: client/capacitor/android/app/build/outputs/apk/debug/app-debug.apk
```

Запустить на подключённом телефоне:

```bash
npm run action client/capacitor/web_build android
cd client/capacitor && npx cap sync android && npx cap run android
```

---

## 3. iOS

Это ограничение Apple, обойти его нельзя: VPN на iPhone работает только через Network Extension. Для этого нужны:

- **Mac** с Xcode, Go и Node.js 22;
- **платный Apple Developer** аккаунт (99 $/год). С бесплатным Apple ID VPN-расширение не подписать.

### Настройка в Apple Developer (один раз)

На [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list) → Certificates, IDs & Profiles:

1. **Identifiers → App Groups** → создайте группу из `appGroup` (например `group.com.fastvpn.app`).
2. **Identifiers → App IDs** → создайте **два** ID:
   - `com.fastvpn.app` — включите **Network Extensions** и **App Groups** (выберите группу из п. 1);
   - `com.fastvpn.app.VpnExtension` — то же самое. Суффикс `.VpnExtension` обязателен.
3. Впишите Team ID в `brand.json` → `appleTeamId` и снова запустите `python3 branding/rebrand.py`.

### Сборка

```bash
npm ci
npm run action client/capacitor/web_build ios
cd client/capacitor
npx cap sync ios          # собирает tun2socks (Go) и копирует веб-часть
npx cap open ios          # открывает проект в Xcode
```

В Xcode: выберите свой iPhone → **Run**. Подпись подставится автоматически (Signing & Capabilities → Automatically manage signing).

**TestFlight / App Store:** Product → Archive → Distribute App.
Или из терминала: `DEVELOPMENT_TEAM=AB12CD34EF npm run action client/capacitor/build ios -- --buildMode=release --versionName=1.0.0`.

---

## 4. Публикация

- **Google Play** и **App Store** проверяют VPN-приложения строже обычных. В Google Play нужно заполнить декларацию VPNService и политику конфиденциальности. App Store принимает VPN-приложения только от организаций, а не от физлиц.
- В некоторых странах VPN-приложения из магазинов удаляют. Тогда Android-версию раздают APK-файлом напрямую.

---

## 5. Что стоит знать

- **Сервер.** Подходит любой сервер Outline (Outline Manager) и ключи `ss://` / `ssconf://`. Клиент совместим с ключами, которые вы уже раздаёте.
- **Ссылки на Outline.** Политика конфиденциальности, условия использования и форма обратной связи в меню всё ещё ведут на сайт Outline. Если хотите свои, замените ссылки в `client/web/views/root_view/root_navigation/index.ts`. Форма «Связаться с нами» без вашего `SENTRY_DSN` ничего не отправляет.
- **Лицензия.** Apache 2.0 разрешает форк и продажу. Обязательно сохраните файл `LICENSE` и упоминание исходного проекта (экран «О программе» мы не трогали). Название «Outline» и его логотип — товарный знак, поэтому их и нужно заменить, что уже сделано.
- **Обновления из Outline.** Подтянуть новые версии исходного клиента:
  ```bash
  git remote add upstream https://github.com/Jigsaw-Code/outline-apps.git
  git fetch upstream && git merge upstream/master
  python3 branding/rebrand.py --assets
  ```

---

## 6. Подписки и трафик

- **Добавить подписку:** нажмите **+** и вставьте ссылку из панели (`https://…/sub/…`, Marzban, 3x-ui, Remnawave и др.). Приложение загрузит все серверы **Shadowsocks** из подписки. Ссылки других протоколов (VLESS, VMess, Trojan) пропускаются: их ядро Outline не поддерживает.
- Поддерживаются шифры `chacha20-ietf-poly1305` и `aes-128/192/256-gcm`. Ключи Shadowsocks-2022 (`2022-blake3-…`) и с плагинами (obfs, v2ray-plugin) не подойдут.
- **Панель сверху** показывает израсходованный трафик и лимит, срок действия и остаток дней. Эти данные берутся из заголовка `Subscription-Userinfo`, который отдают панели. При подключении там же видны скорость ↓↑ и объём за сессию (пока только Android).
- Подписка обновляется сама при запуске и возврате в приложение, раз в 6 часов или с интервалом из заголовка `Profile-Update-Interval`. Её можно обновить кнопкой ⟳ вручную. Серверы, которые исчезли из подписки, удаляются, новые добавляются.
