from __future__ import annotations

import binascii
import json
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets" / "projectiles"
FRAME_SEQUENCE = (0, 1, 2, 1, 2)
FRAME_SIZES = {
    "ladybug_bomb": (577, 340),
    "torpedo": (528, 312),
    "seed_pod": (522, 320),
    "drill_rocket": (571, 332),
    "plasma_pearl": (580, 420),
    "rescue_capsule": (522, 378),
    "ice_crystal": (538, 298),
}
MARGIN = 10
OUTPUT_PADDING_X = 180
OUTPUT_PADDING_Y = 80


def read_rgba_png(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")

    width = height = color_type = bit_depth = None
    compressed = bytearray()
    offset = 8
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        offset += length + 12
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break

    if bit_depth != 8 or color_type != 6 or width is None or height is None:
        raise ValueError(f"Expected 8-bit RGBA PNG: {path}")

    stride = width * 4
    raw = zlib.decompress(bytes(compressed))
    pixels = bytearray(width * height * 4)
    previous = bytearray(stride)
    source_offset = 0
    for y in range(height):
        filter_type = raw[source_offset]
        source_offset += 1
        scanline = bytearray(raw[source_offset : source_offset + stride])
        source_offset += stride
        for x in range(stride):
            left = scanline[x - 4] if x >= 4 else 0
            up = previous[x]
            up_left = previous[x - 4] if x >= 4 else 0
            if filter_type == 1:
                scanline[x] = (scanline[x] + left) & 255
            elif filter_type == 2:
                scanline[x] = (scanline[x] + up) & 255
            elif filter_type == 3:
                scanline[x] = (scanline[x] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                estimate = left + up - up_left
                pa = abs(estimate - left)
                pb = abs(estimate - up)
                pc = abs(estimate - up_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                scanline[x] = (scanline[x] + predictor) & 255
            elif filter_type != 0:
                raise ValueError(f"Unsupported PNG filter {filter_type}")
        pixels[y * stride : (y + 1) * stride] = scanline
        previous = scanline
    return width, height, pixels


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)


def write_rgba_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )


def alpha_bbox(pixels: bytearray, image_width: int, x0: int, y0: int, width: int, height: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = width, height, -1, -1
    for y in range(height):
        row = ((y0 + y) * image_width + x0) * 4
        for x in range(width):
            if pixels[row + x * 4 + 3] == 0:
                continue
            left = min(left, x)
            top = min(top, y)
            right = max(right, x)
            bottom = max(bottom, y)
    if right < left:
        raise ValueError("Empty projectile frame")
    return left, top, right + 1, bottom + 1


def sample_bilinear(pixels: bytearray, width: int, height: int, x: float, y: float) -> tuple[int, int, int, int]:
    x = max(0.0, min(width - 1.0, x))
    y = max(0.0, min(height - 1.0, y))
    x0, y0 = int(x), int(y)
    x1, y1 = min(x0 + 1, width - 1), min(y0 + 1, height - 1)
    tx, ty = x - x0, y - y0
    weights = ((x0, y0, (1 - tx) * (1 - ty)), (x1, y0, tx * (1 - ty)), (x0, y1, (1 - tx) * ty), (x1, y1, tx * ty))
    values = []
    for channel in range(4):
        values.append(round(sum(pixels[(sy * width + sx) * 4 + channel] * weight for sx, sy, weight in weights)))
    return tuple(values)  # type: ignore[return-value]


def normalize_sheet(name: str, frame_width: int, frame_height: int) -> None:
    source_width, source_height, source = read_rgba_png(ASSET_DIR / f"{name}_sheet.png")
    source_frame_width = source_width // 4
    boxes = [
        alpha_bbox(source, source_width, index * source_frame_width, 0, source_frame_width, source_height)
        for index in range(3)
    ]
    max_width = max(right - left for left, _, right, _ in boxes)
    max_height = max(bottom - top for _, top, _, bottom in boxes)
    scale = min(1.0, (frame_width - MARGIN * 2) / max_width, (frame_height - MARGIN * 2) / max_height)
    output = bytearray(frame_width * 5 * frame_height * 4)

    for output_index, source_index in enumerate(FRAME_SEQUENCE):
        left, top, right, bottom = boxes[source_index]
        content_width, content_height = right - left, bottom - top
        target_width = max(1, round(content_width * scale))
        target_height = max(1, round(content_height * scale))
        target_x = output_index * frame_width + frame_width - MARGIN - target_width
        target_y = (frame_height - target_height) // 2
        for y in range(target_height):
            source_y = top + ((y + 0.5) / scale) - 0.5
            for x in range(target_width):
                source_x = source_index * source_frame_width + left + ((x + 0.5) / scale) - 0.5
                rgba = sample_bilinear(source, source_width, source_height, source_x, source_y)
                destination = ((target_y + y) * frame_width * 5 + target_x + x) * 4
                output[destination : destination + 4] = bytes(rgba)

    base_path = ASSET_DIR / f"{name}_flight_base_sheet.png"
    write_rgba_png(base_path, frame_width * 5, frame_height, output)
    print(f"{name}: {frame_width}x{frame_height}, scale={scale:.4f}")


def apply_saved_edits(name: str, frame_width: int, frame_height: int, edits: list[dict[str, float]]) -> None:
    source_width, source_height, source = read_rgba_png(ASSET_DIR / f"{name}_flight_base_sheet.png")
    output_frame_width = frame_width + OUTPUT_PADDING_X * 2
    output_frame_height = frame_height + OUTPUT_PADDING_Y * 2
    output_width = output_frame_width * 5
    output = bytearray(output_width * output_frame_height * 4)

    for frame, edit in enumerate(edits):
        scale = float(edit["scale"])
        edit_x = float(edit["x"])
        edit_y = float(edit["y"])
        left, top, right, bottom = alpha_bbox(source, source_width, frame * frame_width, 0, frame_width, frame_height)
        placement_x = frame * output_frame_width + OUTPUT_PADDING_X + (frame_width - frame_width * scale) / 2 + edit_x
        placement_y = OUTPUT_PADDING_Y + (frame_height - frame_height * scale) / 2 + edit_y
        target_left = max(frame * output_frame_width, int(placement_x + left * scale) - 1)
        target_top = max(0, int(placement_y + top * scale) - 1)
        target_right = min((frame + 1) * output_frame_width, int(placement_x + right * scale) + 2)
        target_bottom = min(output_frame_height, int(placement_y + bottom * scale) + 2)

        for y in range(target_top, target_bottom):
            source_y = ((y - placement_y + 0.5) / scale) - 0.5
            for x in range(target_left, target_right):
                source_x = frame * frame_width + ((x - placement_x + 0.5) / scale) - 0.5
                rgba = sample_bilinear(source, source_width, source_height, source_x, source_y)
                destination = (y * output_width + x) * 4
                output[destination : destination + 4] = bytes(rgba)

    write_rgba_png(ASSET_DIR / f"{name}_flight_sheet.png", output_width, output_frame_height, output)
    print(f"{name}: runtime {output_frame_width}x{output_frame_height}")


def main() -> None:
    for name, size in FRAME_SIZES.items():
        normalize_sheet(name, *size)
    edits_path = ASSET_DIR / "projectile_frame_edits.json"
    if edits_path.exists():
        saved_edits = json.loads(edits_path.read_text(encoding="utf-8"))
        for name, size in FRAME_SIZES.items():
            apply_saved_edits(name, *size, saved_edits[name])


if __name__ == "__main__":
    main()
