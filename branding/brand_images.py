"""Генерация иконки, сплэша и логотипов приложения.

Если в brand.json указан свой "icon" (PNG 1024×1024), он используется как есть.
Иначе рисуется простой значок-щит в фирменном цвете.
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

SS = 4  # суперсэмплинг для сглаживания


def _rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def _shade(rgb, factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(c * factor))) for c in rgb)


def _bezier(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def _shield_points():
    """Контур щита в координатах 0..1."""
    top_l, top_r = (0.18, 0.20), (0.82, 0.20)
    pts = [top_l]
    pts += _bezier(top_l, (0.36, 0.20), (0.44, 0.14), (0.50, 0.10))[1:]
    pts += _bezier((0.50, 0.10), (0.56, 0.14), (0.64, 0.20), top_r)[1:]
    pts += _bezier(top_r, (0.82, 0.52), (0.76, 0.74), (0.50, 0.90))[1:]
    pts += _bezier((0.50, 0.90), (0.24, 0.74), (0.18, 0.52), top_l)[1:]
    return pts


def glyph_mask(size: int) -> Image.Image:
    """Белый щит с прорезью-замочной скважиной (L-маска, 255 = залито)."""
    big = size * SS
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    d.polygon([(x * big, y * big) for x, y in _shield_points()], fill=255)
    # замочная скважина
    cx, cy, r = 0.5 * big, 0.44 * big, 0.085 * big
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=0)
    d.polygon([(0.468 * big, 0.47 * big), (0.532 * big, 0.47 * big),
               (0.552 * big, 0.66 * big), (0.448 * big, 0.66 * big)], fill=0)
    return m.resize((size, size), Image.LANCZOS)


def _gradient(size: int, primary, background) -> Image.Image:
    top = _shade(primary, 1.0)
    bottom = tuple(round(p * 0.45 + b * 0.55) for p, b in zip(primary, background))
    col = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        col.putpixel((0, y), tuple(round(a * (1 - t) + b * t) for a, b in zip(top, bottom)))
    return col.resize((size, size), Image.BICUBIC)


def _place(canvas: Image.Image, mask: Image.Image, color=(255, 255, 255)):
    layer = Image.new("RGBA", mask.size, color + (255,))
    x = (canvas.width - mask.width) // 2
    y = (canvas.height - mask.height) // 2
    canvas.paste(layer, (x, y), mask)


def make_icon(primary, background, custom: Path | None) -> Image.Image:
    if custom:
        return Image.open(custom).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    icon = _gradient(1024, primary, background).convert("RGBA")
    _place(icon, glyph_mask(600))
    return icon


def make_foreground(custom: Path | None) -> Image.Image:
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    if custom:
        # свой значок кладём целиком в безопасную зону адаптивной иконки
        art = Image.open(custom).convert("RGBA").resize((600, 600), Image.LANCZOS)
        fg.paste(art, (212, 212), art)
    else:
        _place(fg, glyph_mask(470))
    return fg


def make_splash(background, icon: Image.Image) -> Image.Image:
    splash = Image.new("RGBA", (2732, 2732), background + (255,))
    small = _rounded(icon.resize((440, 440), Image.LANCZOS), 0.22)
    splash.paste(small, ((2732 - 440) // 2, (2732 - 440) // 2), small)
    return splash


def _rounded(img: Image.Image, radius_frac: float) -> Image.Image:
    big = Image.new("L", (img.width * SS, img.height * SS), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, big.width - 1, big.height - 1], radius=int(big.width * radius_frac), fill=255)
    mask = big.resize(img.size, Image.LANCZOS)
    out = img.copy()
    out.putalpha(ImageChops.multiply(out.getchannel("A"), mask))
    return out


def _font(size: int):
    candidates = [
        "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default(size)


def make_brand_logo(icon: Image.Image, name: str, text_color) -> Image.Image:
    """Значок + название под ним (экран «О приложении»)."""
    w = 320
    tile = _rounded(icon.resize((240, 240), Image.LANCZOS), 0.22)
    size = 64
    font = _font(size)
    while size > 20 and ImageDraw.Draw(Image.new("L", (1, 1))).textlength(name, font=font) > w - 8:
        size -= 2
        font = _font(size)
    asc, desc = font.getmetrics()
    h = 240 + 24 + asc + desc
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(tile, ((w - 240) // 2, 0), tile)
    d = ImageDraw.Draw(out)
    d.text((w / 2, 240 + 24), name, font=font, fill=text_color + (255,), anchor="ma")
    return out


def recolor_circle(path: Path, primary) -> None:
    """Перекрашивает индикатор подключения в фирменный оттенок."""
    img = Image.open(path).convert("RGBA")
    ph, ps, _ = colorsys.rgb_to_hls(*(c / 255 for c in primary))
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            nr, ng, nb = colorsys.hls_to_rgb(ph, l, min(1.0, s * max(ps, 0.4) / 0.6))
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    img.save(path, optimize=True)


def _fit(art: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / art.width, height / art.height)
    return art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)


def _centered(canvas: Image.Image, art: Image.Image) -> Image.Image:
    canvas.alpha_composite(art, ((canvas.width - art.width) // 2, (canvas.height - art.height) // 2))
    return canvas


def _with_border(tile: Image.Image, color=(0, 0, 0, 28), width=3) -> Image.Image:
    """Тонкая рамка, чтобы белая плитка не терялась на белом фоне."""
    big = Image.new("RGBA", (tile.width * SS, tile.height * SS), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, big.width - 1, big.height - 1], radius=int(big.width * 0.22),
        outline=color, width=width * SS)
    out = tile.copy()
    out.alpha_composite(big.resize(tile.size, Image.LANCZOS))
    return out


def write_all(name, primary, background, custom_icon, cap_assets: Path, web_assets: Path,
              icon_art: Path | None = None, icon_background: str | None = None):
    p, bg = _rgb(primary), _rgb(background)
    written = []

    def save(img: Image.Image, path: Path, rgb=False):
        (img.convert("RGB") if rgb else img).save(path, optimize=True)
        written.append(path)

    if icon_art:
        # Картинка (логотип) на однотонной плитке, например на белой.
        art = Image.open(icon_art).convert("RGBA")
        tile_rgb = _rgb(icon_background or "#FFFFFF")
        icon = _centered(Image.new("RGBA", (1024, 1024), tile_rgb + (255,)), _fit(art, 820, 700))
        foreground = _centered(Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)), _fit(art, 600, 600))
        icon_bg_layer = Image.new("RGB", (1024, 1024), tile_rgb)
        splash = Image.new("RGBA", (2732, 2732), bg + (255,))
        if sum(bg) > 600:  # светлый фон заставки: логотип прямо на нём
            _centered(splash, _fit(art, 1100, 1100))
        else:
            small = _rounded(icon.resize((440, 440), Image.LANCZOS), 0.22)
            splash.alpha_composite(small, ((2732 - 440) // 2, (2732 - 440) // 2))
        tile = _with_border(_rounded(icon.resize((274, 274), Image.LANCZOS), 0.22))
        save(_fit(art, 1200, 1200), web_assets / "intro-logo.png")
    else:
        icon = make_icon(p, bg, custom_icon)
        foreground = make_foreground(custom_icon)
        icon_bg_layer = _gradient(1024, p, bg)
        splash = make_splash(bg, icon)
        tile = _rounded(icon.resize((274, 274), Image.LANCZOS), 0.22)

    save(icon, cap_assets / "icon.png", rgb=True)
    save(icon, cap_assets / "icon-only.png", rgb=True)
    save(foreground, cap_assets / "icon-foreground.png")
    save(icon_bg_layer, cap_assets / "icon-background.png", rgb=True)
    save(splash, cap_assets / "splash.png", rgb=True)
    save(splash, cap_assets / "splash-dark.png", rgb=True)

    brand_icon = _with_border(icon) if icon_art else icon
    save(make_brand_logo(brand_icon, name, _shade(p, 0.45)), web_assets / "brand-logo.png")
    save(make_brand_logo(brand_icon, name, (255, 255, 255)), web_assets / "brand-logo-dark.png")
    save(tile, web_assets / "logo-nav.png")

    # Бирюзовые картинки Outline перекрашиваем в фирменный цвет. Всегда из
    # оригинала (branding/.orig), чтобы повторный запуск не «копил» оттенок.
    for fname in ("circle.png", "privacy-lock.png"):
        target = web_assets / fname
        original = Path(__file__).resolve().parent / ".orig" / fname
        if not target.exists():
            continue
        if not original.exists():
            original.parent.mkdir(exist_ok=True)
            original.write_bytes(target.read_bytes())
        target.write_bytes(original.read_bytes())
        recolor_circle(target, p)
        written.append(target)
    return written


def _tray_icon(primary, connected: bool, size: int = 64) -> Image.Image:
    """Щит для трея Windows: зелёный — подключено, серый контур — нет."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    big = size * SS
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    pts = [(0.5 + (x - 0.5) * 1.18, 0.5 + (y - 0.5) * 1.18) for x, y in _shield_points()]
    d.polygon([(x * big, y * big) for x, y in pts], fill=255)
    mask = m.resize((size, size), Image.LANCZOS)
    color = primary if connected else (128, 128, 128)
    img.paste(Image.new("RGBA", (size, size), color + (255,)), (0, 0), mask)
    if connected:
        # белая галочка
        ck = Image.new("L", (big, big), 0)
        dc = ImageDraw.Draw(ck)
        dc.line([(0.32 * big, 0.50 * big), (0.45 * big, 0.63 * big), (0.70 * big, 0.36 * big)],
                fill=255, width=int(0.10 * big), joint="curve")
        img.paste(Image.new("RGBA", (size, size), (255, 255, 255, 255)), (0, 0),
                  ck.resize((size, size), Image.LANCZOS))
    else:
        inner = Image.new("L", (big, big), 0)
        di = ImageDraw.Draw(inner)
        k = 0.80
        pts2 = [(0.5 + (x - 0.5) * k, 0.5 + (y - 0.5) * k) for x, y in pts]
        di.polygon([(x * big, y * big) for x, y in pts2], fill=255)
        img.paste(Image.new("RGBA", (size, size), (0, 0, 0, 0)), (0, 0),
                  inner.resize((size, size), Image.LANCZOS))
    return img


def write_electron(icon: Path, primary, icons_dir: Path, tray_dir: Path):
    """Иконки версии для Windows/Linux (Electron) и значки трея."""
    written = []
    base = Image.open(icon).convert("RGBA")
    png_dir = icons_dir / "png"
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        path = png_dir / f"{size}x{size}.png"
        base.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        written.append(path)
    ico = icons_dir / "win" / "icon.ico"
    base.resize((256, 256), Image.LANCZOS).save(
        ico, sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    written.append(ico)
    p = _rgb(primary)
    for name, connected in (("connected", True), ("disconnected", False)):
        path = tray_dir / f"{name}.png"
        _tray_icon(p, connected).save(path, optimize=True)
        written.append(path)
    return written
