"""Render a titled minimap crop for every area that has coordinates.

Run from the project root after adding coordinates:

    python3 scripts/render-maps.py
"""

import hashlib
import json
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'creatures.json')
TILES = os.path.join(ROOT, 'minimap')
OUT = os.path.join(ROOT, 'data', 'maps')
FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
RADIUS_X = 90
RADIUS_Y = 63
SCALE = 4
WIDTH = RADIUS_X * 2
HEIGHT = RADIUS_Y * 2
MAX_WIDTH = WIDTH * SCALE


def origin(value):
    return value - (value % 256)


def point_of(location):
    points = location.get('coordinates') or []
    for point in points:
        if point.get('kind') == 'map':
            return point
    return points[0] if points else None


def filename(name, x, y, z):
    slug = re.sub(r'[^A-Za-z0-9]+', '_', name).strip('_')[:40] or 'area'
    digest = hashlib.sha1(f'{name}|{x}|{y}|{z}'.encode()).hexdigest()[:8]
    return f'{slug}_{digest}.png'


def wrap(text, font, max_width, draw):
    words = text.split(' ')
    lines = []
    current = ''
    for word in words:
        trial = word if not current else f'{current} {word}'
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
            continue
        if current:
            lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines


def title_layout(text):
    probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    max_width = MAX_WIDTH - 32
    chosen = None
    for size in (28, 24, 20, 16):
        font = ImageFont.truetype(FONT_PATH, size)
        lines = wrap(text, font, max_width, probe)
        if len(lines) <= 4:
            chosen = (font, lines, size)
            break
    if chosen is None:
        font = ImageFont.truetype(FONT_PATH, 16)
        chosen = (font, wrap(text, font, max_width, probe), 16)
    return chosen


def crop(tiles, x, y, z):
    left, top = x - RADIUS_X, y - RADIUS_Y
    canvas = Image.new('RGB', (WIDTH, HEIGHT), (0, 0, 0))
    x0, y0 = origin(left), origin(top)
    x1, y1 = origin(left + WIDTH - 1), origin(top + HEIGHT - 1)
    for tile_x in range(x0, x1 + 1, 256):
        for tile_y in range(y0, y1 + 1, 256):
            path = os.path.join(TILES, f'Minimap_Color_{tile_x}_{tile_y}_{z}.png')
            image = tiles.get(path)
            if image is None:
                if not os.path.exists(path):
                    tiles[path] = False
                    continue
                image = Image.open(path).convert('RGB')
                tiles[path] = image
            if image is False:
                continue
            src_x = max(left, tile_x) - tile_x
            src_y = max(top, tile_y) - tile_y
            dst_x = max(left, tile_x) - left
            dst_y = max(top, tile_y) - top
            width = min(tile_x + 256, left + WIDTH) - max(left, tile_x)
            height = min(tile_y + 256, top + HEIGHT) - max(top, tile_y)
            canvas.paste(image.crop((src_x, src_y, src_x + width, src_y + height)), (dst_x, dst_y))
    return canvas.resize((WIDTH * SCALE, HEIGHT * SCALE), Image.NEAREST)


def compose(canvas, title):
    font, lines, size = title_layout(title)
    line_h = size + 8
    bar_h = 16 + line_h * len(lines)
    sheet = Image.new('RGB', (canvas.width, canvas.height + bar_h), (18, 22, 28))
    draw = ImageDraw.Draw(sheet)
    for index, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        y = 8 + index * line_h - bbox[1]
        draw.text(((sheet.width - text_w) / 2, y), line, fill=(255, 255, 255), font=font)
    sheet.paste(canvas, (0, bar_h))
    return sheet


def main():
    os.makedirs(OUT, exist_ok=True)
    data = json.load(open(DATA, encoding='utf-8'))
    tiles = {}
    rendered = {}
    used = set()
    for creature in data['creatures']:
        for location in creature['locations']:
            point = point_of(location)
            if not point:
                location.pop('mapImage', None)
                continue
            key = (location['name'], point['x'], point['y'], point['z'])
            if key not in rendered:
                image = compose(crop(tiles, point['x'], point['y'], point['z']), location['name'])
                name = filename(*key)
                image.save(os.path.join(OUT, name), optimize=True)
                rendered[key] = f'data/maps/{name}'
            location['mapImage'] = rendered[key]
            used.add(rendered[key])
    json.dump(data, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    removed = 0
    for name in os.listdir(OUT):
        if f'data/maps/{name}' not in used and name.endswith('.png'):
            os.remove(os.path.join(OUT, name))
            removed += 1
    print(f'rendered {len(rendered)} maps, removed {removed} stale files')


if __name__ == '__main__':
    main()
