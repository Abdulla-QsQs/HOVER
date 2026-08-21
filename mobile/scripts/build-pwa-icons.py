from pathlib import Path

from PIL import Image


def render(source: Image.Image, size: int, output: Path) -> None:
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    artwork = source.copy()
    artwork.thumbnail((round(size * 0.92), round(size * 0.92)), Image.Resampling.LANCZOS)
    x = (size - artwork.width) // 2
    y = (size - artwork.height) // 2
    canvas.paste(artwork, (x, y), artwork)
    canvas.save(output, "PNG", optimize=True)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    output = root / "public" / "assets" / "hover"
    source = Image.open(output / "icon.png").convert("RGBA")
    render(source, 512, output / "icon-maskable.png")
    render(source, 192, output / "icon-maskable-192.png")
    render(source, 180, output / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
