#!/usr/bin/env python3
"""Ребрендинг клиента Outline (Capacitor: Android + iOS; Electron: Windows).

Использование (из корня репозитория):
    python3 branding/rebrand.py            # применить branding/brand.json
    python3 branding/rebrand.py --assets   # + пересобрать иконки/сплэши платформ

Скрипт можно запускать повторно: прошлые значения хранятся в
branding/.applied.json, поэтому смена имени или ID работает и во второй раз.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import re
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

ROOT = Path(__file__).resolve().parent.parent
BRANDING = ROOT / "branding"
STATE_FILE = BRANDING / ".applied.json"
CAP = ROOT / "client" / "capacitor"
WEB = ROOT / "client" / "web"
ELECTRON = ROOT / "client" / "electron"
APPLE_LIB = ROOT / "client" / "src" / "cordova" / "apple" / "OutlineLib"

# Значения исходного Outline: от них отталкиваемся при первом запуске.
UPSTREAM = {
    "name": "Outline",
    "androidId": "org.outline.android.client",
    "iosId": "org.outline.ios.client",
    "appGroup": "group.org.getoutline.client",
    "supportUrl": "https://support.getoutline.org",
    "getKeyUrl": "https://s3.amazonaws.com/outline-vpn/get-started/#step-1",
}
URL_KEYS = ("supportUrl", "getKeyUrl")
STATE_KEYS = ("name", "androidId", "iosId", "appGroup") + URL_KEYS

# Эти тексты в Outline рассказывали о самом Outline: скрипт пишет их заново
# из шаблонов ниже ({name} — название приложения), а не заменой слова.
PROTECTED_MESSAGE_KEYS = {"about-outline", "server-create-your-own-zero-state"}
MESSAGE_TEMPLATES = {
    "about-outline": {
        "ru": "{name} — приложение для защищённого подключения к интернету через ваш VPN-сервер. "
              "Работает по протоколу <a href={{shadowsocksUrl}}>Shadowsocks</a>.<br><br>"
              "Создано на основе открытого исходного кода "
              "(<a href={{gitHubUrl}}>лицензия Apache 2.0</a>).",
        "en": "{name} is an app for a secure connection to the internet through your own VPN server. "
              "It uses the <a href={{shadowsocksUrl}}>Shadowsocks</a> protocol.<br><br>"
              "Built on open-source software "
              "(<a href={{gitHubUrl}}>Apache License 2.0</a>).",
    },
    "server-create-your-own-zero-state": {
        "ru": "Нет сервера?<br>Добавьте ключ доступа или ссылку подписки, которую вам дали.",
        "en": "No server?<br>Add the access key or subscription link you were given.",
    },
}

ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")
IOS_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9\-]*(\.[A-Za-z][A-Za-z0-9\-]*)+$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
TEAM_RE = re.compile(r"^[A-Z0-9]{10}$")

changed_files: list[str] = []


def fail(msg: str) -> None:
    print(f"ОШИБКА: {msg}", file=sys.stderr)
    sys.exit(1)


def load_config() -> dict:
    cfg = json.loads((BRANDING / "brand.json").read_text(encoding="utf-8"))
    name = str(cfg.get("name", "")).strip()
    if not name or len(name) > 30:
        fail("name должен быть от 1 до 30 символов")
    if not ID_RE.match(cfg.get("androidId", "")):
        fail("androidId должен выглядеть как com.company.app (латиница, цифры, _, без дефисов)")
    if not IOS_ID_RE.match(cfg.get("iosId", "")):
        fail("iosId должен выглядеть как com.company.app")
    group = cfg.get("appGroup", "")
    if not (group.startswith("group.") and IOS_ID_RE.match(group[len("group."):])):
        fail("appGroup должен начинаться с group. — например group.com.company.app")
    for key in ("primaryColor", "backgroundColor"):
        if not HEX_RE.match(cfg.get(key, "")):
            fail(f"{key} должен быть цветом вида #RRGGBB")
    if cfg.get("headerColor") and not HEX_RE.match(cfg["headerColor"]):
        fail("headerColor должен быть цветом вида #RRGGBB")
    team = cfg.get("appleTeamId", "")
    if team and not TEAM_RE.match(team):
        fail("appleTeamId — это 10 символов из Apple Developer (Membership → Team ID)")
    for key in URL_KEYS:
        url = str(cfg.get(key, "")).strip()
        if not url:
            url = UPSTREAM[key]  # пусто = оставить ссылку Outline
        if not re.match(r"^https://[^\s\"'<>]+$", url):
            fail(f"{key} должен быть ссылкой https://… без пробелов и кавычек")
        cfg[key] = url
    cfg["name"] = name
    return cfg


def edit(path: Path, fn) -> None:
    old = path.read_text(encoding="utf-8")
    new = fn(old)
    if new != old:
        path.write_text(new, encoding="utf-8")
        changed_files.append(str(path.relative_to(ROOT)))


def sub_required(text: str, pattern: str, repl, path: Path, flags=0) -> str:
    new, n = re.subn(pattern, repl, text, flags=flags)
    if n == 0:
        print(f"  ! не найдено в {path.relative_to(ROOT)}: {pattern}")
    return new


def pbx_quote(value: str) -> str:
    return value if re.fullmatch(r"[A-Za-z0-9_.\-]+", value) else json.dumps(value, ensure_ascii=False)


# ---------------------------------------------------------------- цвета
def hex_to_hsl(hex_color: str) -> tuple[float, float, float]:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s * 100, l * 100


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    return round(r * 255), round(g * 255), round(b * 255)


def palette(primary: str) -> dict:
    h, s, l = hex_to_hsl(primary)
    s = max(s, 35)
    return {
        "primary": (h, s, l),
        "dark": (h, min(s + 20, 97), max(l * 0.55, 18)),
        "medium": (h, s, 72),
        "light": (h, s, 91),
    }


def header_color(cfg: dict) -> str:
    """Цвет верхней панели и меню: из brand.json или тёмный оттенок основного."""
    if cfg.get("headerColor"):
        return cfg["headerColor"].upper()
    h, s, l = hex_to_hsl(cfg["primaryColor"])
    r, g, b = hsl_to_rgb(h, min(s, 70), 20)
    return f"#{r:02X}{g:02X}{b:02X}"


def css_hsl(c) -> str:
    return f"hsl({c[0]:.0f}, {c[1]:.0f}%, {c[2]:.0f}%)"


# ---------------------------------------------------------------- шаги
def apply_capacitor_config(cfg: dict) -> None:
    path = CAP / "capacitor.config.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["appId"] = cfg["iosId"]
    data["appName"] = cfg["name"]
    data["plugins"]["SplashScreen"]["backgroundColor"] = cfg["backgroundColor"]
    new = json.dumps(data, indent=4, ensure_ascii=False) + "\n"
    if new != path.read_text(encoding="utf-8"):
        path.write_text(new, encoding="utf-8")
        changed_files.append(str(path.relative_to(ROOT)))


def apply_android(cfg: dict) -> None:
    gradle = CAP / "android" / "app" / "build.gradle"
    edit(gradle, lambda t: sub_required(
        t, r'(applicationId\s+")[^"]+(")', rf'\g<1>{cfg["androidId"]}\g<2>', gradle))

    strings = CAP / "android" / "app" / "src" / "main" / "res" / "values" / "strings.xml"
    for key in ("app_name", "title_activity_main"):
        edit(strings, lambda t, key=key: sub_required(
            t, rf'(<string name="{key}">).*?(</string>)',
            lambda m: m.group(1) + xml_escape(cfg["name"]) + m.group(2), strings))

    pal = palette(cfg["primaryColor"])
    colors = CAP / "android" / "app" / "src" / "main" / "res" / "values" / "colors.xml"
    android_colors = {
        "colorPrimary": header_color(cfg),
        "colorPrimaryDark": header_color(cfg),
        "colorAccent": cfg["primaryColor"].upper(),
    }
    for key, value in android_colors.items():
        edit(colors, lambda t, key=key, value=value: sub_required(
            t, rf'(name="{key}">)#[0-9A-Fa-f]{{6}}(</color>)', rf"\g<1>{value}\g<2>", colors))

    service = (ROOT / "client" / "src" / "cordova" / "android" / "OutlineAndroidLib" / "outline"
               / "src" / "main" / "java" / "org" / "outline" / "vpn" / "VpnTunnelService.java")
    rgb = hsl_to_rgb(*pal["primary"])
    java_name = cfg["name"].replace("\\", "\\\\").replace('"', '\\"')
    edit(service, lambda t: sub_required(
        t, r'(NOTIFICATION_CHANNEL_ID, )"[^"]*"', lambda m: m.group(1) + f'"{java_name}"', service))
    edit(service, lambda t: sub_required(
        t, r"(NOTIFICATION_COLOR = )0x[0-9A-Fa-f]{6};",
        rf"\g<1>0x{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X};", service))


def apply_ios(cfg: dict, prev: dict) -> None:
    plist = CAP / "ios" / "App" / "App" / "Info.plist"
    edit(plist, lambda t: sub_required(
        t, r"(<key>CFBundleDisplayName</key>\s*<string>).*?(</string>)",
        lambda m: m.group(1) + xml_escape(cfg["name"]) + m.group(2), plist))

    app_pbx = CAP / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
    lib_pbx = APPLE_LIB / "OutlineLib.xcodeproj" / "project.pbxproj"

    def fix_app(t: str) -> str:
        t = sub_required(t, r"(INFOPLIST_KEY_CFBundleDisplayName = )[^;]+;",
                         lambda m: m.group(1) + pbx_quote(cfg["name"]) + ";", app_pbx)
        t = sub_required(t, r"(\bPRODUCT_BUNDLE_IDENTIFIER = )" + re.escape(prev["iosId"]) + ";",
                         rf'\g<1>{cfg["iosId"]};', app_pbx)
        if cfg.get("appleTeamId"):
            t = re.sub(r"(DEVELOPMENT_TEAM = )[^;]*;", rf'\g<1>{cfg["appleTeamId"]};', t)
        return t

    def fix_lib(t: str) -> str:
        # Расширение VPN обязано называться <bundle id приложения>.VpnExtension —
        # OutlineVpn.swift вычисляет его именно так.
        t = sub_required(t, r"(\bPRODUCT_BUNDLE_IDENTIFIER = )" + re.escape(prev["iosId"]) + r"\.VpnExtension;",
                         rf'\g<1>{cfg["iosId"]}.VpnExtension;', lib_pbx)
        if cfg.get("appleTeamId"):
            t = re.sub(r"(DEVELOPMENT_TEAM = )[^;]*;", rf'\g<1>{cfg["appleTeamId"]};', t)
        return t

    edit(app_pbx, fix_app)
    edit(lib_pbx, fix_lib)

    group_files = [
        CAP / "ios" / "App" / "App" / "App.entitlements",
        CAP / "plugins" / "capacitor-plugin-outline" / "ios" / "Sources" / "CapacitorPluginOutline" / "CapacitorPluginOutline.swift",
        APPLE_LIB / "VpnExtension" / "VpnExtension.entitlements",
        APPLE_LIB / "VpnExtension" / "Sources" / "PacketTunnelProvider.m",
    ]
    for f in group_files:
        edit(f, lambda t, f=f: t.replace(prev["appGroup"], cfg["appGroup"]))


def apply_web(cfg: dict, prev: dict) -> None:
    index = CAP / "src" / "index.html"
    edit(index, lambda t: sub_required(
        t, r"(<title>).*?(</title>)", lambda m: m.group(1) + xml_escape(cfg["name"]) + m.group(2), index))

    pal = palette(cfg["primaryColor"])
    rgb = hsl_to_rgb(*pal["primary"])
    style = WEB / "style.css"

    def fix_css(t: str) -> str:
        for var, key in (("primary", "primary"), ("primary-dark", "dark"),
                         ("primary-medium", "medium"), ("primary-light", "light")):
            t = sub_required(t, rf"(--outline-{var}:\s*)[^;]+;", rf"\g<1>{css_hsl(pal[key])};", style)
        t = sub_required(t, r"(--outline-primary-rgb:\s*)[^;]+;", rf"\g<1>{rgb[0]}, {rgb[1]}, {rgb[2]};", style)
        # Верхняя панель и боковое меню.
        t = sub_required(t, r"(--outline-dark-primary:\s*)[^;]+;", rf"\g<1>{header_color(cfg)};", style)
        return t

    edit(style, fix_css)

    def to_hex(c) -> str:
        return "#%02x%02x%02x" % hsl_to_rgb(*c)

    # Заголовок главного экрана берётся не из переводов, а из запасного значения.
    header = WEB / "views" / "root_view" / "root_header" / "index.ts"
    js_name = "'" + cfg["name"].replace("\\", "\\\\").replace("'", "\\'") + "'"
    edit(header, lambda t: sub_required(
        t, r"(this\.title \|\| )'(?:[^'\\]|\\.)*'", lambda m: m.group(1) + js_name, header))

    # Ссылки «Помощь» в меню и «Создайте ключ на нашем сайте».
    nav = WEB / "views" / "root_view" / "root_navigation" / "index.ts"
    edit(nav, lambda t: t.replace(f'href="{prev["supportUrl"]}"', f'href="{cfg["supportUrl"]}"'))
    dialog = WEB / "views" / "root_view" / "add_access_key_dialog" / "index.ts"
    edit(dialog, lambda t: t.replace(f"<a href={prev['getKeyUrl']}>", f"<a href={cfg['getKeyUrl']}>"))

    # app-root.js берёт цвета из --outline-primary (их можно менять в настройках
    # приложения), отдельно перекрашивать его не нужно.

    # Название в текстах интерфейса, на всех языках.
    old_name = re.escape(prev["name"])
    word = re.compile(rf"(?<![A-Za-z]){old_name}(?![A-Za-z])")
    line_re = re.compile(r'^(\s*"([^"]+)":\s*")(.*)(",?\s*)$')

    def fix_messages(t: str) -> str:
        out = []
        for line in t.splitlines(keepends=True):
            m = line_re.match(line)
            if m and m.group(2) not in PROTECTED_MESSAGE_KEYS:
                value = word.sub(cfg["name"].replace("\\", "\\\\").replace('"', '\\"'), m.group(3))
                # Склоняемые формы в других языках: «Outlineom» → «ProVPN-om».
                value = re.sub(r"(?<![A-Za-z])Outline(?=[a-zäöå])",
                               cfg["name"].replace("\\", "\\\\") + "-", value)
                line = m.group(1) + value + m.group(4)
            out.append(line)
        return "".join(out)

    for f in sorted((WEB / "messages").glob("*.json")):
        edit(f, fix_messages)
        lang = "ru" if f.stem == "ru" else "en"
        for key, texts in MESSAGE_TEMPLATES.items():
            value = texts[lang].format(name=cfg["name"])
            encoded = json.dumps(value, ensure_ascii=False)
            edit(f, lambda t, key=key, encoded=encoded: re.sub(
                rf'^(\s*"{re.escape(key)}":\s*)".*"(,?)$',
                lambda m: m.group(1) + encoded + m.group(2), t, flags=re.M))


# ---------------------------------------------------------------- картинки
def apply_electron(cfg: dict, prev: dict) -> None:
    """Версия для Windows (Electron): имя, установщик, заголовок окна, трей."""
    name = cfg["name"]
    slug = re.sub(r"[^A-Za-z0-9]+", "", name) or "App"
    desktop_id = cfg.get("desktopId") or re.sub(r"\.android$", "", cfg["androidId"]) + ".desktop"

    builder = ELECTRON / "electron-builder.json"

    def fix_builder(t: str) -> str:
        conf = json.loads(t)
        conf["appId"] = desktop_id
        conf["productName"] = name
        conf["artifactName"] = f"{slug}-Setup-${{arch}}.${{ext}}"
        # Своё имя пакета = своя папка настроек (%APPDATA%), не как у Outline.
        # Задаётся один раз: при смене названия серверы на ПК не пропадают.
        meta = conf.setdefault("extraMetadata", {})
        if meta.get("name", "outline-client") == "outline-client":
            meta["name"] = slug.lower() + "-client"
        nsis = conf.setdefault("nsis", {})
        nsis.update({
            "oneClick": False,
            "allowToChangeInstallationDirectory": True,
            "createDesktopShortcut": True,
            "createStartMenuShortcut": True,
            "shortcutName": name,
            "uninstallDisplayName": name,
            "runAfterFinish": True,
        })
        return json.dumps(conf, indent=2, ensure_ascii=False) + "\n"

    edit(builder, fix_builder)

    html_file = WEB / "index_electron.html"
    edit(html_file, lambda t: sub_required(
        t, r"(<title>).*?(</title>)", lambda m: m.group(1) + xml_escape(name) + m.group(2), html_file))

    main_ts = ELECTRON / "index.ts"
    edit(main_ts, lambda t: sub_required(
        t, r"tray\.setToolTip\('[^']*'\)", f"tray.setToolTip('{name}')", main_ts))

    routing = ELECTRON / "routing_service.ts"
    edit(routing, lambda t: sub_required(
        t, r"(sudo\.exec\(command, \{name: ')[^']*'", lambda m: m.group(1) + slug + "'", routing))

    nsh = ELECTRON / "custom_install_steps.nsh"

    def fix_nsh(t: str) -> str:
        # Только тексты окон установщика; служба OutlineService не переименовывается.
        def fix_line(m):
            old = {prev["name"], UPSTREAM["name"]}
            pattern = "|".join(re.escape(o) for o in old)
            return re.sub(rf"\b(?:{pattern})\b(?!Service)", name, m.group(0))
        return re.sub(r'MessageBox MB_OK "(?:[^"\\]|\\.|\\\n)*"', fix_line, t, flags=re.S)

    edit(nsh, fix_nsh)


def apply_images(cfg: dict, generate_platform_assets: bool) -> None:
    try:
        from PIL import Image
    except ImportError:
        print("  ! Pillow не установлен (pip install pillow) — иконки не обновлены")
        return
    import brand_images  # рядом со скриптом

    custom = (BRANDING / cfg["icon"]) if cfg.get("icon") else None
    if custom and not custom.exists():
        fail(f"icon: файл {custom} не найден")
    art = (BRANDING / cfg["iconArt"]) if cfg.get("iconArt") else None
    if art and not art.exists():
        fail(f"iconArt: файл {art} не найден")
    written = brand_images.write_all(
        name=cfg["name"],
        primary=cfg["primaryColor"],
        background=cfg["backgroundColor"],
        custom_icon=custom,
        cap_assets=CAP / "assets",
        web_assets=WEB / "assets",
        icon_art=art,
        icon_background=cfg.get("iconBackground"),
    )
    changed_files.extend(str(p.relative_to(ROOT)) for p in written)
    written = brand_images.write_electron(
        icon=CAP / "assets" / "icon.png",
        primary=cfg["primaryColor"],
        icons_dir=ELECTRON / "icons",
        tray_dir=ROOT / "client" / "resources" / "tray",
    )
    changed_files.extend(str(p.relative_to(ROOT)) for p in written)

    if generate_platform_assets:
        print("→ Генерирую иконки и сплэши для Android и iOS (capacitor-assets)…")
        if not (ROOT / "node_modules").exists():
            fail("сначала выполните npm ci в корне репозитория")
        # capacitor-assets переформатирует манифест и стирает лицензионные
        # заголовки в XML адаптивной иконки, хотя по смыслу их не меняет —
        # возвращаем эти файлы как были.
        res = CAP / "android" / "app" / "src" / "main"
        keep = [res / "AndroidManifest.xml",
                res / "res" / "mipmap-anydpi-v26" / "ic_launcher.xml",
                res / "res" / "mipmap-anydpi-v26" / "ic_launcher_round.xml"]
        saved = {p: p.read_bytes() for p in keep if p.exists()}
        try:
            subprocess.run(["npm", "run", "assets:generate"], cwd=CAP, check=True)
        finally:
            for p, data in saved.items():
                p.write_bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--assets", action="store_true",
                        help="также пересобрать иконки/сплэши в android/ и ios/ (нужен npm ci)")
    parser.add_argument("--no-images", action="store_true", help="не трогать картинки")
    args = parser.parse_args()

    sys.path.insert(0, str(BRANDING))
    cfg = load_config()
    prev = dict(UPSTREAM)
    if STATE_FILE.exists():
        prev.update(json.loads(STATE_FILE.read_text(encoding="utf-8")))

    print(f"→ Ребрендинг: «{prev['name']}» → «{cfg['name']}»")
    apply_capacitor_config(cfg)
    apply_android(cfg)
    apply_ios(cfg, prev)
    apply_web(cfg, prev)
    apply_electron(cfg, prev)
    if not args.no_images:
        apply_images(cfg, args.assets)

    STATE_FILE.write_text(json.dumps(
        {k: cfg[k] for k in STATE_KEYS},
        indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Готово, изменено файлов: {len(changed_files)}")
    for f in changed_files:
        print("  •", f)


if __name__ == "__main__":
    main()
