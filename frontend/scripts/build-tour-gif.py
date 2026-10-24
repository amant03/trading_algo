"""Rasterize the homepage product tour and the social share image.

Sample figures only — the GIF is a guided look at the terminal, not a quote feed.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SHEET = ROOT.parent / ".scratch" / "tour-sheet.png"

W, H = 760, 428
BG = (16, 14, 12)
PANEL = (28, 25, 20)
PANEL2 = (38, 33, 26)
INK = (26, 20, 12)
TEXT = (246, 241, 231)
MUTED = (183, 171, 150)
DIM = (126, 116, 100)
GOLD = (226, 177, 90)
UP = (61, 190, 134)
DOWN = (224, 122, 104)
LINE = (70, 60, 46)


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    windir = Path("C:/Windows/Fonts")
    if mono:
        names = ["consolab.ttf", "courbd.ttf"] if bold else ["consola.ttf", "cour.ttf"]
    elif bold:
        names = ["segoeuib.ttf", "arialbd.ttf"]
    else:
        names = ["segoeui.ttf", "arial.ttf"]
    for name in names:
        path = windir / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


F = {
    "kicker": font(11, bold=True, mono=True),
    "brand": font(13, bold=True),
    "mark": font(11, bold=True),
    "h": font(18, bold=True),
    "body": font(13),
    "small": font(12),
    "tiny": font(11),
    "mono": font(12, mono=True),
    "mono_b": font(12, bold=True, mono=True),
    "px": font(22, bold=True, mono=True),
    "cap": font(13),
}


def new_frame() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), BG)
    return im, ImageDraw.Draw(im)


def chrome(draw: ImageDraw.ImageDraw, scene: str, caption: str, index: int, total: int) -> None:
    draw.rectangle([0, 0, W, 40], fill=PANEL)
    draw.rounded_rectangle([12, 8, 36, 32], radius=5, fill=INK, outline=GOLD, width=1)
    draw.text((24, 20), "TA", font=F["mark"], fill=GOLD, anchor="mm")
    draw.text((44, 20), "TRADE ALGO", font=F["brand"], fill=TEXT, anchor="lm")
    draw.text((W - 14, 20), scene.upper(), font=F["kicker"], fill=GOLD, anchor="rm")
    draw.rectangle([0, H - 36, W, H], fill=PANEL)
    draw.text((14, H - 18), caption, font=F["cap"], fill=MUTED, anchor="lm")
    label = f"{index + 1:02d}  /  {total:02d}"
    draw.text((W - 14, H - 18), label, font=F["kicker"], fill=DIM, anchor="rm")
    draw.rectangle([0, H - 3, int(W * (index + 1) / total), H], fill=GOLD)


def panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str) -> None:
    draw.rounded_rectangle(box, radius=10, fill=PANEL, outline=LINE, width=1)
    draw.text((box[0] + 14, box[1] + 16), title.upper(), font=F["kicker"], fill=DIM, anchor="lm")


def candles(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], rows: list[tuple[float, float, float, float]]) -> None:
    x0, y0, x1, y1 = box
    hi = max(max(h, o, c) for o, h, _l, c in rows)
    lo = min(min(l, o, c) for o, _h, l, c in rows)
    span = hi - lo or 1
    gap = (x1 - x0) / len(rows)

    def yy(p: float) -> float:
        return y1 - (p - lo) / span * (y1 - y0)

    for i, (o, h, l, c) in enumerate(rows):
        cx = x0 + gap * i + gap / 2
        color = UP if c >= o else DOWN
        draw.line([(cx, yy(h)), (cx, yy(l))], fill=color, width=2)
        top, bot = sorted((yy(o), yy(c)))
        draw.rectangle([cx - gap * 0.26, top, cx + gap * 0.26, max(bot, top + 2)], fill=color)


OHLC = [
    (100, 108, 98, 106),
    (106, 110, 101, 103),
    (103, 112, 102, 111),
    (111, 114, 105, 107),
    (107, 116, 106, 115),
    (115, 118, 109, 110),
    (110, 117, 108, 116),
    (116, 124, 114, 122),
    (122, 126, 118, 119),
    (119, 128, 117, 127),
    (127, 130, 121, 123),
    (123, 129, 120, 128),
    (128, 136, 126, 134),
    (134, 138, 129, 131),
    (131, 140, 130, 139),
    (139, 142, 133, 136),
]


def dashboard(draw: ImageDraw.ImageDraw, hot: int) -> None:
    panel(draw, (16, 52, 250, 150), "Nifty 50")
    draw.text((30, 92), "24,532.40", font=F["px"], fill=TEXT, anchor="lm")
    draw.text((30, 124), "+0.42% today", font=F["mono_b"], fill=UP, anchor="lm")
    panel(draw, (262, 52, 496, 150), "Breadth")
    draw.text((276, 92), "312", font=F["px"], fill=UP, anchor="lm")
    draw.text((348, 96), "/  188", font=F["h"], fill=DOWN, anchor="lm")
    draw.text((276, 124), "500 liquid names", font=F["tiny"], fill=DIM, anchor="lm")
    panel(draw, (508, 52, 744, 150), "Signals")
    draw.text((522, 92), "24", font=F["px"], fill=GOLD, anchor="lm")
    draw.text((522, 124), "across 8 strategies", font=F["tiny"], fill=DIM, anchor="lm")

    panel(draw, (16, 162, 470, 384), "Market movers")
    rows = [
        ("RELIANCE", "2,948", "+1.24%", True),
        ("TCS", "4,112", "−0.38%", False),
        ("HDFCBANK", "1,684", "+0.71%", True),
        ("INFY", "1,842", "+1.62%", True),
        ("ICICIBANK", "1,276", "−0.22%", False),
    ]
    for i, (sym, px, chg, up) in enumerate(rows):
        y = 196 + i * 34
        if i == hot:
            draw.rounded_rectangle([26, y - 8, 458, y + 20], radius=6, fill=(48, 40, 28))
        draw.text((32, y + 6), sym, font=F["mono_b"], fill=TEXT, anchor="lm")
        draw.text((250, y + 6), px, font=F["mono"], fill=MUTED, anchor="lm")
        draw.text((360, y + 6), chg, font=F["mono_b"], fill=UP if up else DOWN, anchor="lm")

    panel(draw, (482, 162, 744, 384), "Sectors")
    sectors = [("Energy", 0.86, True), ("IT", 0.64, True), ("Banks", 0.12, True), ("FMCG", -0.28, False), ("Metal", -0.41, False)]
    for i, (name, pct, up) in enumerate(sectors):
        y = 198 + i * 34
        draw.text((496, y), name, font=F["small"], fill=MUTED, anchor="lm")
        draw.text((730, y), f"{pct:+.2f}%", font=F["mono"], fill=UP if up else DOWN, anchor="rm")
        width = int(abs(pct) / 0.9 * 150)
        draw.rectangle([496, y + 12, 496 + max(width, 8), y + 18], fill=UP if up else DOWN)


def search(draw: ImageDraw.ImageDraw, query: str, picked: int) -> None:
    draw.rounded_rectangle([16, 56, 744, 96], radius=10, fill=PANEL, outline=GOLD, width=1)
    draw.text((32, 76), query, font=F["h"], fill=TEXT, anchor="lm")
    draw.rectangle([query_width(query) + 36, 64, query_width(query) + 38, 88], fill=GOLD)
    hits = [
        ("RELIANCE", "Reliance Industries", "NSE"),
        ("RELIANCE", "Reliance Industries", "BSE"),
        ("RELIANCEP1", "Reliance Power", "BSE"),
    ]
    for i, (sym, name, ex) in enumerate(hits):
        y = 112 + i * 64
        fill = (48, 40, 28) if i == picked else PANEL
        draw.rounded_rectangle([16, y, 744, y + 54], radius=10, fill=fill, outline=LINE, width=1)
        draw.text((32, y + 18), sym, font=F["mono_b"], fill=GOLD if i == picked else TEXT, anchor="lm")
        draw.text((180, y + 18), name, font=F["body"], fill=MUTED, anchor="lm")
        draw.text((720, y + 18), ex, font=F["kicker"], fill=DIM, anchor="rm")


def query_width(text: str) -> int:
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    return int(probe.textlength(text, font=F["h"]))


def stock(draw: ImageDraw.ImageDraw, tab: int) -> None:
    draw.text((20, 62), "RELIANCE", font=F["px"], fill=TEXT, anchor="lm")
    draw.text((168, 64), "Reliance Industries · Energy", font=F["small"], fill=MUTED, anchor="lm")
    draw.text((20, 100), "2,948.30", font=F["px"], fill=UP, anchor="lm")
    draw.text((168, 104), "+1.24%  ·  NSE", font=F["mono_b"], fill=UP, anchor="lm")
    tabs = ["Overview", "Fundamentals", "Peers", "Technical", "AI", "News"]
    x = 20
    for i, label in enumerate(tabs):
        tw = int(ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(label, font=F["small"])) + 22
        if i == tab:
            draw.rounded_rectangle([x, 132, x + tw, 158], radius=7, fill=(48, 40, 28), outline=GOLD, width=1)
        draw.text((x + 11, 145), label, font=F["small"], fill=TEXT if i == tab else DIM, anchor="lm")
        x += tw + 6
    panel(draw, (16, 172, 520, 384), "6 month")
    candles(draw, (32, 204, 500, 366), OHLC)
    panel(draw, (532, 172, 744, 384), "Snapshot")
    stats = [("RSI 14", "61.4"), ("MACD", "Bull"), ("P/E", "24.1"), ("ROE", "9.2%")]
    for i, (k, v) in enumerate(stats):
        y = 210 + i * 40
        draw.text((548, y), k, font=F["tiny"], fill=DIM, anchor="lm")
        draw.text((726, y), v, font=F["mono_b"], fill=TEXT, anchor="rm")


def peers(draw: ImageDraw.ImageDraw, hot: int) -> None:
    draw.text((20, 64), "Peers  ·  Energy", font=F["h"], fill=TEXT, anchor="lm")
    draw.text((20, 92), "Same sector, side by side. Open any row.", font=F["small"], fill=MUTED, anchor="lm")
    headers = [(32, "Symbol"), (220, "P/E"), (340, "ROE"), (470, "1Y"), (600, "Stance")]
    for x, label in headers:
        draw.text((x, 132), label.upper(), font=F["kicker"], fill=DIM, anchor="lm")
    rows = [
        ("RELIANCE", "24.1", "9.2%", "+18%", "Buy"),
        ("ONGC", "8.4", "14%", "+11%", "Hold"),
        ("BPCL", "11.2", "18%", "+6%", "Hold"),
        ("IOC", "9.7", "16%", "−2%", "Hold"),
        ("HINDPETRO", "12.6", "15%", "+9%", "Buy"),
    ]
    for i, (sym, pe, roe, yr, stance) in enumerate(rows):
        y = 156 + i * 42
        if i == hot:
            draw.rounded_rectangle([16, y - 8, 744, y + 26], radius=8, fill=(48, 40, 28))
        up = not yr.startswith("−")
        draw.text((32, y + 8), sym, font=F["mono_b"], fill=GOLD if i == hot else TEXT, anchor="lm")
        draw.text((220, y + 8), pe, font=F["mono"], fill=MUTED, anchor="lm")
        draw.text((340, y + 8), roe, font=F["mono"], fill=MUTED, anchor="lm")
        draw.text((470, y + 8), yr, font=F["mono_b"], fill=UP if up else DOWN, anchor="lm")
        draw.text((600, y + 8), stance, font=F["small"], fill=UP if stance == "Buy" else MUTED, anchor="lm")


def paper(draw: ImageDraw.ImageDraw, filled: bool) -> None:
    cards = [("Virtual cash", "₹86,420" if filled else "₹1,00,000"), ("Open", "1" if filled else "0"), ("Day P&L", "+₹420" if filled else "₹0")]
    for i, (label, value) in enumerate(cards):
        x = 16 + i * 248
        panel(draw, (x, 52, x + 236, 132), label)
        color = UP if value.startswith("+") else TEXT
        draw.text((x + 16, 96), value, font=F["h"], fill=color, anchor="lm")
    panel(draw, (16, 146, 744, 384), "Paper book  ·  simulated")
    if not filled:
        draw.text((32, 200), "No open position. Ticket staged.", font=F["body"], fill=MUTED, anchor="lm")
        draw.rounded_rectangle([32, 230, 220, 270], radius=8, fill=UP)
        draw.text((126, 250), "BUY  RELIANCE", font=F["mono_b"], fill=INK, anchor="mm")
        draw.text((240, 250), "10 shares  ·  market  ·  paper only", font=F["small"], fill=MUTED, anchor="lm")
    else:
        headers = ["Symbol", "Qty", "Entry", "Last", "P&L"]
        xs = [32, 200, 320, 460, 600]
        for x, label in zip(xs, headers):
            draw.text((x, 180), label.upper(), font=F["kicker"], fill=DIM, anchor="lm")
        draw.text((32, 214), "RELIANCE", font=F["mono_b"], fill=GOLD, anchor="lm")
        draw.text((200, 214), "10", font=F["mono"], fill=TEXT, anchor="lm")
        draw.text((320, 214), "2,906", font=F["mono"], fill=MUTED, anchor="lm")
        draw.text((460, 214), "2,948", font=F["mono"], fill=TEXT, anchor="lm")
        draw.text((600, 214), "+₹420", font=F["mono_b"], fill=UP, anchor="lm")
        draw.text((32, 268), "Filled in the paper broker. Not sent to the exchange.", font=F["small"], fill=MUTED, anchor="lm")
        draw.text((32, 300), "Intraday book resets with virtual cash the next session.", font=F["tiny"], fill=DIM, anchor="lm")


def algos(draw: ImageDraw.ImageDraw, hot: int) -> None:
    items = [
        ("MA cross", "Golden cross · trend", False),
        ("RSI reversal", "BUY RELIANCE · RSI left 30", True),
        ("MACD cross", "Histogram turn · volume", True),
        ("Bollinger", "Quiet · inside the bands", False),
        ("Supertrend", "Trend still up", True),
        ("VWAP reclaim", "Watching the session VWAP", False),
    ]
    for i, (name, blurb, on) in enumerate(items):
        col, row = i % 2, i // 2
        x, y = 16 + col * 372, 52 + row * 110
        outline = GOLD if i == hot else LINE
        draw.rounded_rectangle([x, y, x + 356, y + 98], radius=10, fill=(48, 40, 28) if i == hot else PANEL, outline=outline, width=1)
        draw.text((x + 16, y + 28), name, font=F["h"], fill=TEXT, anchor="lm")
        draw.text((x + 16, y + 58), blurb, font=F["small"], fill=MUTED, anchor="lm")
        pill = "ON" if on else "OFF"
        draw.text((x + 336, y + 28), pill, font=F["kicker"], fill=UP if on else DIM, anchor="rm")


def news(draw: ImageDraw.ImageDraw) -> None:
    panel(draw, (16, 52, 470, 384), "News sentiment")
    draw.text((32, 96), "62% positive", font=F["h"], fill=UP, anchor="lm")
    draw.text((32, 124), "in the India headline feed", font=F["tiny"], fill=DIM, anchor="lm")
    headlines = [
        ("Energy", "Refiners lead as crude slips", "Bullish"),
        ("Banks", "Credit growth holds in the fortnight", "Neutral"),
        ("IT", "Deal wins offset a soft quarter", "Bullish"),
    ]
    for i, (tag, title, sent) in enumerate(headlines):
        y = 160 + i * 68
        draw.text((32, y), tag.upper(), font=F["kicker"], fill=GOLD, anchor="lm")
        draw.text((120, y), sent, font=F["kicker"], fill=UP if sent == "Bullish" else MUTED, anchor="lm")
        draw.text((32, y + 22), title, font=F["body"], fill=TEXT, anchor="lm")
    panel(draw, (482, 52, 744, 384), "Screener")
    draw.text((496, 96), "Fundamental lens", font=F["small"], fill=MUTED, anchor="lm")
    picks = [("INFY", "Quality"), ("HDFCBANK", "Value"), ("TCS", "Quality")]
    for i, (sym, tag) in enumerate(picks):
        y = 130 + i * 70
        draw.rounded_rectangle([496, y, 728, y + 56], radius=8, fill=PANEL2)
        draw.text((510, y + 20), sym, font=F["mono_b"], fill=TEXT, anchor="lm")
        draw.text((510, y + 40), tag, font=F["tiny"], fill=GOLD, anchor="lm")


SCENES: list[tuple[str, str, str]] = [
    ("dashboard", "Dashboard", "Start on the tape: index, breadth, movers, sectors."),
    ("dashboard-hot", "Dashboard", "Click a mover to open that listing."),
    ("search", "Stock search", "Type a name. NSE and BSE both resolve."),
    ("search-pick", "Stock search", "Pick the listing and the stock page opens."),
    ("chart", "Stock page", "Price, candlestick history, and the indicator snapshot."),
    ("chart-tab", "Stock page", "Switch across fundamentals, technicals, AI, and news."),
    ("peers", "Peer comparison", "Set the name beside others in the same sector."),
    ("peers-hot", "Peer comparison", "Ratios and stance, row by row."),
    ("paper", "Paper trading", "Stage a buy with virtual cash. It stays simulated."),
    ("paper-fill", "Paper trading", "The paper book marks the fill. No exchange order."),
    ("algos", "Algorithms", "Eight strategies. Turn a book on or leave it off."),
    ("algos-hot", "Algorithms", "A signal names the ticker, the side, and why."),
    ("news", "News & screen", "Sentiment, headlines, and a fundamental screen."),
    ("news-hold", "News & screen", "Then back to the tape — search, compare, practise."),
]


def render(kind: str, index: int, total: int) -> Image.Image:
    im, draw = new_frame()
    caption = next(c for k, _s, c in SCENES if k == kind)
    scene = next(s for k, s, _c in SCENES if k == kind)
    chrome(draw, scene, caption, index, total)
    if kind == "dashboard":
        dashboard(draw, hot=-1)
    elif kind == "dashboard-hot":
        dashboard(draw, hot=0)
    elif kind == "search":
        search(draw, "reli", picked=-1)
    elif kind == "search-pick":
        search(draw, "reliance", picked=0)
    elif kind == "chart":
        stock(draw, tab=0)
    elif kind == "chart-tab":
        stock(draw, tab=2)
    elif kind == "peers":
        peers(draw, hot=-1)
    elif kind == "peers-hot":
        peers(draw, hot=0)
    elif kind == "paper":
        paper(draw, filled=False)
    elif kind == "paper-fill":
        paper(draw, filled=True)
    elif kind == "algos":
        algos(draw, hot=-1)
    elif kind == "algos-hot":
        algos(draw, hot=1)
    else:
        news(draw)
    return im


def contact_sheet(frames: list[Image.Image]) -> None:
    cols = 4
    thumb_w = 320
    scale = thumb_w / W
    thumb_h = int(H * scale)
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w, rows * thumb_h), (0, 0, 0))
    for i, frame in enumerate(frames):
        thumb = frame.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(thumb, ((i % cols) * thumb_w, (i // cols) * thumb_h))
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(SHEET, optimize=True)


def og_card() -> None:
    im = Image.new("RGB", (1200, 630), BG)
    draw = ImageDraw.Draw(im)
    draw.rectangle([0, 0, 1200, 8], fill=GOLD)
    draw.rounded_rectangle([72, 78, 156, 162], radius=16, fill=INK, outline=GOLD, width=3)
    mark = font(36, bold=True)
    draw.text((114, 120), "TA", font=mark, fill=GOLD, anchor="mm")
    display = font(64, bold=True)
    draw.text((184, 118), "TRADE ALGO", font=display, fill=TEXT, anchor="lm")
    sub = font(28)
    draw.text((72, 230), "NSE & BSE paper-trading terminal", font=sub, fill=MUTED, anchor="lm")
    body = font(24)
    lines = [
        "Search a listing. Compare it with peers.",
        "Read charts, signals, and news.",
        "Practise orders with virtual cash.",
    ]
    for i, line in enumerate(lines):
        draw.text((72, 310 + i * 40), line, font=body, fill=TEXT, anchor="lm")
    chips = ["Paper trading", "Peer comparison", "8 algorithms", "No real orders"]
    x = 72
    chip_font = font(18, bold=True)
    for chip in chips:
        tw = int(draw.textlength(chip, font=chip_font)) + 36
        draw.rounded_rectangle([x, 500, x + tw, 552], radius=18, fill=PANEL, outline=GOLD, width=1)
        draw.text((x + 18, 526), chip, font=chip_font, fill=GOLD, anchor="lm")
        x += tw + 14
    im.save(PUBLIC / "og.png", optimize=True)


def apple_icon() -> None:
    im = Image.new("RGB", (180, 180), (26, 20, 12))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle([8, 8, 172, 172], radius=36, outline=GOLD, width=6)
    draw.text((90, 96), "TA", font=font(64, bold=True), fill=GOLD, anchor="mm")
    im.save(PUBLIC / "apple-touch-icon.png", optimize=True)


def main() -> None:
    total = len(SCENES)
    frames = [render(kind, i, total) for i, (kind, _scene, _cap) in enumerate(SCENES)]
    frames[0].save(PUBLIC / "tradealgo-tour-poster.png", optimize=True)
    frames[0].save(
        PUBLIC / "tradealgo-tour.gif",
        save_all=True,
        append_images=frames[1:],
        duration=850,
        loop=0,
        optimize=True,
        disposal=2,
    )
    contact_sheet(frames)
    og_card()
    apple_icon()
    gif = PUBLIC / "tradealgo-tour.gif"
    print(f"gif {gif.stat().st_size} bytes  frames {len(frames)}")
    print(f"poster {(PUBLIC / 'tradealgo-tour-poster.png').stat().st_size}")
    print(f"og {(PUBLIC / 'og.png').stat().st_size}")


if __name__ == "__main__":
    main()
