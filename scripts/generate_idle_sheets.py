from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
TANK_DIR = ROOT / "public" / "assets" / "tanks"
MASK_DIR = TANK_DIR / "masks"

FRAME_W = 720
FRAME_H = 420
FRAME_GAP = 72
FRAME_COUNT = 8
BASELINE_Y = 366
MAX_TANK_W = 610
MAX_TANK_H = 330


@dataclass(frozen=True)
class SheetSpec:
    source: str
    output: str
    eyelid_color: tuple[int, int, int, int]
    fallback_eye_center: tuple[float, float]
    fallback_eye_radius: tuple[float, float]
    use_eye_detection: bool = False


SPECS = [
    SheetSpec(
        source="tank3.png",
        output="tank3_idle_sheet.png",
        eyelid_color=(91, 183, 42, 238),
        fallback_eye_center=(0.565, 0.365),
        fallback_eye_radius=(0.104, 0.126),
    ),
    SheetSpec(
        source="tank4.png",
        output="tank4_idle_sheet.png",
        eyelid_color=(247, 198, 21, 238),
        fallback_eye_center=(0.445, 0.405),
        fallback_eye_radius=(0.118, 0.132),
    ),
    SheetSpec(
        source="tank1.png",
        output="tank1_idle_sheet.png",
        eyelid_color=(218, 32, 22, 238),
        fallback_eye_center=(0.610, 0.410),
        fallback_eye_radius=(0.092, 0.118),
    ),
    SheetSpec(
        source="tank2.png",
        output="tank2_idle_sheet.png",
        eyelid_color=(23, 137, 231, 238),
        fallback_eye_center=(0.410, 0.465),
        fallback_eye_radius=(0.126, 0.126),
    ),
    SheetSpec(
        source="tank5.png",
        output="tank5_idle_sheet.png",
        eyelid_color=(114, 42, 196, 238),
        fallback_eye_center=(0.425, 0.405),
        fallback_eye_radius=(0.125, 0.132),
    ),
    SheetSpec(
        source="tank6.png",
        output="tank6_idle_sheet.png",
        eyelid_color=(238, 232, 220, 238),
        fallback_eye_center=(0.435, 0.420),
        fallback_eye_radius=(0.118, 0.132),
    ),
    SheetSpec(
        source="tank8.png",
        output="tank8_idle_sheet.png",
        eyelid_color=(28, 183, 190, 238),
        fallback_eye_center=(0.440, 0.385),
        fallback_eye_radius=(0.112, 0.126),
    ),
]

BLINK_SEQUENCE = [0.0, 0.0, 0.18, 0.58, 0.92, 0.58, 0.18, 0.0]
BREATH_SEQUENCE = [0, -1, -2, -2, -1, 0, 1, 0]


def is_checker_pixel(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    if alpha <= 8:
        return True
    return min(red, green, blue) >= 218 and max(red, green, blue) - min(red, green, blue) <= 18


def remove_edge_checker_background(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not is_checker_pixel(pixels[x, y]):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                push(nx, ny)

    output = image.copy()
    output_pixels = output.load()
    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                red, green, blue, _alpha = output_pixels[x, y]
                output_pixels[x, y] = (red, green, blue, 0)

    bounds = output.getchannel("A").getbbox()
    if not bounds:
        return output

    padding = 12
    left = max(0, bounds[0] - padding)
    top = max(0, bounds[1] - padding)
    right = min(width, bounds[2] + padding)
    bottom = min(height, bounds[3] + padding)
    return output.crop((left, top, right, bottom))


def fit_to_frame(image: Image.Image) -> Image.Image:
    scale = min(MAX_TANK_W / image.width, MAX_TANK_H / image.height)
    size = (round(image.width * scale), round(image.height * scale))
    return image.resize(size, Image.Resampling.LANCZOS)


def find_eye_anchor(tank: Image.Image, spec: SheetSpec) -> tuple[int, int, int, int, bool]:
    fallback = get_fallback_eye_anchor(tank, spec)
    if not spec.use_eye_detection:
        return fallback

    pixels = tank.load()
    width, height = tank.size
    visited = bytearray(width * height)
    components: list[tuple[int, int, int, int, int, int]] = []

    def is_dark_eye_pixel(x: int, y: int) -> bool:
        red, green, blue, alpha = pixels[x, y]
        if alpha <= 32:
            return False
        return max(red, green, blue) < 55

    for y in range(0, round(height * 0.72)):
        for x in range(width):
            index = y * width + x
            if visited[index] or not is_dark_eye_pixel(x, y):
                continue

            queue: deque[tuple[int, int]] = deque([(x, y)])
            visited[index] = 1
            min_x = max_x = x
            min_y = max_y = y
            count = 0

            while queue:
                cx, cy = queue.popleft()
                count += 1
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    next_index = ny * width + nx
                    if visited[next_index] or not is_dark_eye_pixel(nx, ny):
                        continue
                    visited[next_index] = 1
                    queue.append((nx, ny))

            box_w = max_x - min_x + 1
            box_h = max_y - min_y + 1
            if 45 <= count <= 9000 and 5 <= box_w <= width * 0.18 and 5 <= box_h <= height * 0.20:
                components.append((min_x, min_y, max_x, max_y, count, score_eye_candidate(tank, min_x, min_y, max_x, max_y)))

    if components:
        min_x, min_y, max_x, max_y, _count, _score = max(components, key=lambda item: item[5])
        center_x = round((min_x + max_x) / 2)
        center_y = round((min_y + max_y) / 2)
        radius_x = max(18, round((max_x - min_x + 1) * 1.65))
        radius_y = max(15, round((max_y - min_y + 1) * 1.18))
        return center_x, center_y, radius_x, radius_y, True

    return fallback


def get_fallback_eye_anchor(tank: Image.Image, spec: SheetSpec) -> tuple[int, int, int, int, bool]:
    width, height = tank.size
    center_x = round(width * spec.fallback_eye_center[0])
    center_y = round(height * spec.fallback_eye_center[1])
    radius_x = max(18, round(width * spec.fallback_eye_radius[0]))
    radius_y = max(15, round(height * spec.fallback_eye_radius[1]))
    return center_x, center_y, radius_x, radius_y, False


def score_eye_candidate(tank: Image.Image, min_x: int, min_y: int, max_x: int, max_y: int) -> int:
    pixels = tank.load()
    width, height = tank.size
    cx = round((min_x + max_x) / 2)
    cy = round((min_y + max_y) / 2)
    rx = max(16, round((max_x - min_x + 1) * 2.4))
    ry = max(14, round((max_y - min_y + 1) * 1.8))
    white_score = 0
    dark_score = 0

    for y in range(max(0, cy - ry), min(height, cy + ry + 1)):
        for x in range(max(0, cx - rx), min(width, cx + rx + 1)):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= 32:
                continue
            max_channel = max(red, green, blue)
            min_channel = min(red, green, blue)
            if max_channel > 168 and max_channel - min_channel < 58:
                white_score += 2
            if max_channel < 60:
                dark_score += 1

    upper_preference = max(0, round(height * 0.66) - cy)
    size = (max_x - min_x + 1) * (max_y - min_y + 1)
    return white_score + dark_score + upper_preference - max(0, size - 2600) // 8


def compose_frame(
    tank: Image.Image,
    spec: SheetSpec,
    blink: float,
    breath_y: int,
    eye_anchor: tuple[int, int, int, int, bool],
    source_mask: Image.Image | None,
) -> Image.Image:
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    x = round((FRAME_W - tank.width) / 2)
    y = round(BASELINE_Y - tank.height + breath_y)
    frame.alpha_composite(tank, (x, y))

    if blink > 0:
        anchor_x, anchor_y, eye_rx, eye_ry, _detected = eye_anchor
        eye_x = x + anchor_x
        eye_y = y + anchor_y
        closed_height = max(2, round(eye_ry * (1 - blink)))
        cover_top = eye_y - eye_ry
        cover_bottom = eye_y + eye_ry
        eye_mask = get_shifted_eye_mask(source_mask, breath_y)
        if eye_mask is None:
            eye_box = (eye_x - eye_rx, eye_y - eye_ry, eye_x + eye_rx, eye_y + eye_ry)
            eye_mask = Image.new("L", (FRAME_W, FRAME_H), 0)
            eye_mask_draw = ImageDraw.Draw(eye_mask)
            eye_mask_draw.ellipse(eye_box, fill=255)

        mask_bounds = eye_mask.getbbox()
        if not mask_bounds:
            return frame

        mask_center_y = round((mask_bounds[1] + mask_bounds[3]) / 2)
        mask_radius_y = max(2, round((mask_bounds[3] - mask_bounds[1]) / 2))
        closed_height = max(2, round(mask_radius_y * (1 - blink)))
        cover_mask = Image.new("L", (FRAME_W, FRAME_H), 0)
        cover_draw = ImageDraw.Draw(cover_mask)

        if blink < 0.85:
            cover_draw.rectangle((mask_bounds[0], mask_bounds[1], mask_bounds[2], mask_center_y - closed_height), fill=255)
            cover_draw.rectangle((mask_bounds[0], mask_center_y + closed_height, mask_bounds[2], mask_bounds[3]), fill=255)
        else:
            cover_draw.rectangle(mask_bounds, fill=255)

        clipped_cover = ImageChops.multiply(eye_mask, cover_mask)
        eyelid_layer = Image.new("RGBA", (FRAME_W, FRAME_H), spec.eyelid_color)
        frame.paste(eyelid_layer, (0, 0), clipped_cover)

        if blink >= 0.5:
            draw = ImageDraw.Draw(frame, "RGBA")
            draw.line(
                (
                    mask_bounds[0] + round((mask_bounds[2] - mask_bounds[0]) * 0.14),
                    mask_center_y,
                    mask_bounds[2] - round((mask_bounds[2] - mask_bounds[0]) * 0.14),
                    mask_center_y,
                ),
                fill=(6, 6, 6, 235),
                width=max(3, round(mask_radius_y * 0.12)),
            )

    return frame


def get_shifted_eye_mask(source_mask: Image.Image | None, breath_y: int) -> Image.Image | None:
    if source_mask is None:
        return None

    mask = Image.new("L", (FRAME_W, FRAME_H), 0)
    mask.paste(source_mask, (0, breath_y))
    return mask


def create_sheet(spec: SheetSpec) -> None:
    source = remove_edge_checker_background(Image.open(TANK_DIR / spec.source))
    tank = fit_to_frame(source)
    eye_anchor = find_eye_anchor(tank, spec)
    source_mask = load_eye_mask(spec)
    sheet_w = FRAME_W * FRAME_COUNT + FRAME_GAP * (FRAME_COUNT - 1)
    sheet = Image.new("RGBA", (sheet_w, FRAME_H), (0, 0, 0, 0))

    for index, blink in enumerate(BLINK_SEQUENCE):
        frame = compose_frame(tank, spec, blink, BREATH_SEQUENCE[index], eye_anchor, source_mask)
        sheet.alpha_composite(frame, (index * (FRAME_W + FRAME_GAP), 0))

    sheet.save(TANK_DIR / spec.output)
    alpha = sheet.getchannel("A")
    anchor_x, anchor_y, radius_x, radius_y, detected = eye_anchor
    print(
        f"{spec.output}: size={sheet.size}, bbox={alpha.getbbox()}, corners={get_corners(alpha)}, "
        f"eye=({anchor_x},{anchor_y},{radius_x},{radius_y}), detected={detected}, mask={source_mask is not None}"
    )


def load_eye_mask(spec: SheetSpec) -> Image.Image | None:
    mask_name = f"{Path(spec.source).stem}_eye_mask.png"
    mask_path = TANK_DIR / mask_name
    if not mask_path.exists():
        mask_path = MASK_DIR / mask_name
    if not mask_path.exists():
        return None

    mask_image = Image.open(mask_path).convert("RGBA")
    if mask_image.size != (FRAME_W, FRAME_H):
        mask_image = mask_image.resize((FRAME_W, FRAME_H), Image.Resampling.NEAREST)
    return mask_image.getchannel("A")


def get_corners(alpha) -> list[int]:
    width, height = alpha.size
    return [
        alpha.getpixel((0, 0)),
        alpha.getpixel((width - 1, 0)),
        alpha.getpixel((0, height - 1)),
        alpha.getpixel((width - 1, height - 1)),
    ]


def main() -> None:
    for spec in SPECS:
        create_sheet(spec)


if __name__ == "__main__":
    main()
