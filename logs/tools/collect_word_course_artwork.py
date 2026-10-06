"""Collect licensed Wikimedia Commons tank photos for the proposed word course.

Requires Pillow. Run this file with discover, download, or validate.
Discovery creates a review contact sheet; downloading uses only the selected,
explicit Commons file titles in images/word-course-artwork.json. No generated
images or changes to the existing artwork are involved.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "images" / "word-course"
MANIFEST = ROOT / "images" / "word-course-artwork.json"
REVIEW = ROOT / "logs" / "artifacts" / "word-course-artwork"
USER_AGENT = "ReadingLearnerArtwork/1.0 (https://github.com/bitbutter/readinglearner)"
ALLOWED_PHOTO_LICENSES = {"Public domain", "CC0", "CC BY 2.0", "CC BY 3.0", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 2.5", "CC BY-SA 3.0", "CC BY-SA 4.0"}
TANK_MODELS = [
    ("m1-abrams", "M1 Abrams tank"),
    ("leopard-2", "Leopard 2 tank"),
    ("challenger-2", "Challenger 2 tank"),
    ("leclerc", "Leclerc tank"),
    ("merkava", "Merkava tank"),
    ("k2-black-panther", "K2 Black Panther tank"),
    ("type-10", "Type 10 tank"),
    ("type-90", "Type 90 tank"),
    ("ariete", "Ariete tank"),
    ("t-90", "T-90 tank"),
    ("t-72", "T-72 tank"),
    ("t-80", "T-80 tank"),
    ("t-64", "T-64 tank"),
    ("chieftain", "Chieftain tank"),
    ("centurion", "Centurion tank"),
    ("m60", "M60 tank"),
    ("m48-patton", "M48 Patton tank"),
    ("m26-pershing", "M26 Pershing tank"),
    ("sherman", "M4 Sherman tank"),
    ("churchill", "Churchill tank"),
    ("cromwell", "Cromwell tank"),
    ("comet", "Comet tank"),
    ("valentine", "Valentine tank"),
    ("crusader", "Crusader tank"),
    ("matilda", "Matilda tank"),
    ("panther", "Panther tank museum"),
    ("tiger", "Tiger tank museum"),
    ("panzer-iv", "Panzer IV tank museum"),
    ("t-34", "T-34 tank"),
    ("kv-1", "KV-1 tank museum"),
    ("renault-ft", "Renault FT tank"),
]


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read()


def query_api(**parameters):
    parameters.update(action="query", format="json", formatversion=2)
    answer = json.loads(fetch("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(parameters)))
    if "error" in answer:
        raise RuntimeError(f"Commons rejected the artwork request: {answer['error']}")
    return answer


def plain_text(raw_html):
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw_html))).strip()
    return "Unknown author" if text == "Unknown author Unknown author" else text


def photo_metadata(page):
    image = page["imageinfo"][0]
    fields = {key: value["value"] for key, value in image["extmetadata"].items()}
    license_name = fields.get("LicenseShortName", "")
    if not license_name:
        raise ValueError(f"Missing licence metadata for {page['title']}")
    license_url = fields.get("LicenseUrl", "")
    if license_name == "Public domain" and not license_url:
        license_url = "https://commons.wikimedia.org/wiki/Commons:Copyright_tags#Public_domain"
    return {
        "commonsFileTitle": page["title"],
        "title": plain_text(fields.get("ObjectName", page["title"][5:])),
        "description": plain_text(fields.get("ImageDescription", "")),
        "author": plain_text(fields.get("Artist", "")),
        "credit": plain_text(fields.get("Credit", "")),
        "license": license_name,
        "licenseUrl": license_url,
        "licensePermission": plain_text(fields.get("Permission", "")),
        "attributionRequired": fields.get("AttributionRequired", "") == "true",
        "sourcePageUrl": image["descriptionurl"],
        "originalImageUrl": image["url"].split("?")[0],
        "downloadImageUrl": image.get("thumburl", image["url"]).split("?")[0],
        "sourceWidth": image["width"],
        "sourceHeight": image["height"],
    }


def discover_model(tank_model):
    slug, query = tank_model
    answer = query_api(generator="search", gsrsearch=query + " -destroyed -wreck", gsrnamespace=6,
                       gsrlimit=12, prop="imageinfo", iiprop="url|size|mime|extmetadata", iiurlwidth=480)
    candidates = []
    for page in sorted(answer.get("query", {}).get("pages", []), key=lambda p: p.get("index", 999)):
        if not page.get("imageinfo"):
            continue
        image = page["imageinfo"][0]
        if image["width"] < 1000 or image["height"] >= image["width"] or image["mime"] != "image/jpeg":
            continue
        candidate = photo_metadata(page)
        if candidate["license"] not in ALLOWED_PHOTO_LICENSES:
            continue
        candidate["modelSlug"] = slug
        candidates.append(candidate)
        if len(candidates) == 3:
            break
    if not candidates:
        raise RuntimeError(f"No eligible photos returned for {query}")
    return candidates


def contact_sheet(photos, output, columns=4):
    card_width, card_height = 320, 242
    sheet = Image.new("RGB", (columns * card_width, ((len(photos) + columns - 1) // columns) * card_height), "#eff2f7")
    draw = ImageDraw.Draw(sheet)
    for index, (photo, picture) in enumerate(photos):
        x, y = (index % columns) * card_width, (index // columns) * card_height
        preview = ImageOps.contain(picture, (card_width - 12, card_height - 44))
        sheet.paste(preview, (x + (card_width - preview.width) // 2, y + 4))
        label = f"{index + 1}. {photo.get('modelSlug', photo.get('id', ''))}"
        draw.text((x + 7, y + card_height - 34), label, fill="black")
        draw.text((x + 7, y + card_height - 18), photo["commonsFileTitle"][5:][:46], fill="black")
    sheet.save(output, quality=86)


def discover():
    REVIEW.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as workers:
        discovered = list(workers.map(discover_model, TANK_MODELS))
    candidates = [photo for group in discovered for photo in group]
    (REVIEW / "candidates.json").write_text(json.dumps(candidates, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with ThreadPoolExecutor(max_workers=3) as workers:
        previews = list(workers.map(lambda photo: Image.open(io.BytesIO(fetch(photo["downloadImageUrl"]))).convert("RGB"), candidates))
    contact_sheet(list(zip(candidates, previews)), REVIEW / "candidates-contact-sheet.jpg", columns=6)
    print(json.dumps([{"index": index + 1, "model": p["modelSlug"], "title": p["commonsFileTitle"], "license": p["license"], "description": p["description"][:240]} for index, p in enumerate(candidates)], ensure_ascii=True))


def download_photo(selection):
    answer = query_api(titles=selection["commonsFileTitle"], prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=1600)
    page = answer["query"]["pages"][0]
    photo = photo_metadata(page)
    if not photo["author"] or not photo["licenseUrl"]:
        raise ValueError(f"Missing required attribution for {photo['commonsFileTitle']}")
    if photo["license"] not in ALLOWED_PHOTO_LICENSES:
        raise ValueError(f"Unapproved photograph licence: {photo['license']}")
    picture = Image.open(io.BytesIO(fetch(photo["downloadImageUrl"]))).convert("RGB")
    picture.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    destination = ROOT / selection["path"]
    if destination.parent != ASSETS:
        raise ValueError(f"Asset path must be immediately inside {ASSETS}: {destination}")
    picture.save(destination, "JPEG", quality=87, optimize=True)
    photo["sourceTitle"] = photo["title"]
    photo.update({key: selection[key] for key in ("id", "title", "modelSlug", "path", "commonsFileTitle")})
    photo.update(width=picture.width, height=picture.height, byteLength=destination.stat().st_size,
                 sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
                 modifications="Resized to a maximum width of 1600 pixels and re-encoded as JPEG; no other changes.")
    return photo


def download():
    artwork = json.loads(MANIFEST.read_text(encoding="utf-8"))
    selections = artwork["tankPhotographs"]
    if len(selections) != 31 or len({p["commonsFileTitle"] for p in selections}) != 31:
        raise ValueError("The proposed course requires exactly 31 distinct tank photographs")
    ASSETS.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as workers:
        artwork["tankPhotographs"] = list(workers.map(download_photo, selections))
    MANIFEST.write_text(json.dumps(artwork, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REVIEW.mkdir(parents=True, exist_ok=True)
    pictures = [(p, Image.open(ROOT / p["path"]).convert("RGB")) for p in artwork["tankPhotographs"]]
    contact_sheet(pictures, REVIEW / "selected-contact-sheet.jpg")
    print(f"Saved {len(pictures)} tank photos; total {sum(p['byteLength'] for p in artwork['tankPhotographs']) / 1_000_000:.1f} MB")


def validate():
    artwork = json.loads(MANIFEST.read_text(encoding="utf-8"))
    photographs = artwork["tankPhotographs"]
    assert len(artwork["existingArtwork"]) == 10
    assert len({p["path"] for p in photographs + artwork["existingArtwork"]}) == 41
    assert all((ROOT / p["path"]).is_file() for p in artwork["existingArtwork"])
    assert len(photographs) == 31
    assert len({p["sha256"] for p in photographs}) == 31
    for photo in photographs:
        asset = ROOT / photo["path"]
        assert hashlib.sha256(asset.read_bytes()).hexdigest() == photo["sha256"], photo["path"]
        with Image.open(asset) as picture:
            picture.verify()
        assert photo["width"] <= 1600 and photo["width"] > photo["height"], photo["path"]
        assert photo["license"] in ALLOWED_PHOTO_LICENSES, photo["path"]
        for required in ("commonsFileTitle", "title", "author", "license", "licenseUrl", "sourcePageUrl", "originalImageUrl", "downloadImageUrl"):
            assert photo[required], f"{photo['path']}: missing {required}"
    print(f"Validated {len(photographs)} unique, readable landscape photographs and their source/credit/licence records.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("discover", "download", "validate"))
    {"discover": discover, "download": download, "validate": validate}[parser.parse_args().action]()
