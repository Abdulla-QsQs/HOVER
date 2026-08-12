from pathlib import Path
import sys

from PIL import Image


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/build-icon.py <source-image>")

    source_path = Path(sys.argv[1])
    output_dir = Path(__file__).resolve().parents[1] / "assets"
    output_dir.mkdir(parents=True, exist_ok=True)

    source = Image.open(source_path).convert("RGBA")
    canvas_size = 512
    inset = 22
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    # Trim transparent padding while preserving antialiased painted edges.
    artwork_bounds = source.getchannel("A").getbbox()
    if artwork_bounds:
        source = source.crop(artwork_bounds)

    source.thumbnail(
        (canvas_size - inset * 2, canvas_size - inset * 2),
        Image.Resampling.LANCZOS,
    )
    x = (canvas_size - source.width) // 2
    y = (canvas_size - source.height) // 2
    canvas.alpha_composite(source, (x, y))

    png_path = output_dir / "hover.png"
    ico_path = output_dir / "hover.ico"
    canvas.save(png_path, "PNG", optimize=True)
    canvas.save(
        ico_path,
        "ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Created {png_path}")
    print(f"Created {ico_path}")


if __name__ == "__main__":
    main()
