from pathlib import Path

from PIL import Image


ROOT = Path("public/assets/tanks")
OUT = Path("tmp/tank_debug_frames")
FRAME_W = 720
FRAME_H = 420


def alpha_bounds(image: Image.Image):
    pixels = image.convert("RGBA")
    alpha = pixels.getchannel("A")
    return alpha.getbbox()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for tank_id in ["tank1", "tank2", "tank3", "tank4", "tank5", "tank6", "tank8"]:
        source = ROOT / f"{tank_id}_idle_sheet.png"
        image = Image.open(source).convert("RGBA")
        frame = image.crop((0, 0, FRAME_W, FRAME_H))
        bbox = alpha_bounds(frame)
        if bbox:
            frame = frame.crop(bbox)
        frame.save(OUT / f"{tank_id}_frame0.png")


if __name__ == "__main__":
    main()
