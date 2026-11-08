#!/usr/bin/env python3
"""Build a searchable JSON index from the Unitec master catalogue PDF.

The generated index keeps every PDF page as a first-class record so the web app
can never hide a page just because a product code was not detected.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path


SECTIONS = [
    ("turning", "Turning", 3, 64, "Turning inserts, grades, chipbreakers, holders and boring bars"),
    ("pcd", "PCD Inserts", 65, 69, "PCD-tipped inserts for non-ferrous materials"),
    ("ceramic", "Ceramic Inserts", 70, 80, "Ceramic grades for cast iron, hardened steel and HRSA"),
    ("grooving", "Grooving & Parting", 81, 135, "Parting, grooving, blades, bars and inserts"),
    ("milling", "Milling", 136, 205, "Shoulder, face and high-feed milling"),
    ("endmills", "Solid Carbide End Mills", 206, 224, "Seven solid-carbide end-mill series"),
    ("drilling", "Drilling", 225, 261, "U-drills, spot drills, VMD and spade drills"),
    ("crown", "Crown & Combined Drills", 262, 279, "KS crown drills and combined drills"),
    ("gundrills", "Gun Drills", 280, 317, "Indexable gun drills and deep-hole accessories"),
    ("bta", "BTA Deep Hole Drilling", 318, 432, "BTA heads, DEEP-ACE/RAY/LINE and drill tubes"),
    ("threading", "Threading & Thread Milling", 433, 546, "Thread turning, thread mills and deep-hole threading"),
    ("holders", "Tool Holders & Adapters", 547, 607, "HSK, BT, SK, CAT, ISO holders and accessories"),
    ("hydraulic", "Hydraulic Chucks", 608, 621, "Power chucks, workholding, centres and face drivers"),
]

CODE_RE = re.compile(r"\b[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)*(?:\d[A-Z0-9-]*)?\b")
GRADE_RE = re.compile(r"\b(?:UP|UM|UK|US|UC|UH|UT|UN|UTC|IC)\s*-?\s*\d{2,4}[A-Z]?\b", re.IGNORECASE)
WORD_RE = re.compile(r"[a-z0-9]+")
BAD_CODES = {
    "UNITEC", "PRODUCT", "APPLICATION", "DIMENSIONS", "MATERIALS", "DESIGNATION",
    "TECHNICAL", "CATALOGUE", "CUTTING", "VALUES", "RECOMMENDED", "GENERAL",
    "INTERNAL", "EXTERNAL", "CENTRE", "CENTERS", "INserts", "INSERTS", "HOLDER",
    "HOLDERS", "MILLING", "DRILLING", "THREADING", "GROOVING", "TURNING", "CHUCK",
    "CHUCKS", "SERIES", "SYSTEM", "SYSTEMS", "TABLE", "PAGE", "SECTION", "ISO",
    "DIN", "ANSI", "TOOLS", "TOOL", "HEAD", "HEADS", "BODY", "BODIES", "TYPE",
    "SIZE", "SIZES", "GRADE", "GRADES", "RANGE", "ITEM", "ITEMS", "CONTINUED",
}

INSERT_PREFIXES = (
    "CC", "DC", "SC", "TC", "VB", "WB", "CN", "DN", "SN", "TN", "VN", "WN",
    "APMT", "CCGT", "CCMT", "DCGT", "DCMT", "GR", "NPMT", "RPMT", "SDMT", "SEKT",
    "SNEW", "TPKN", "WOMT", "ZPMT", "TOHT", "LOGT", "TPGX", "RCGX", "RNGN", "UN",
)


def classify_item(code: str, section_id: str, page_texts: list[str]) -> str:
    """Give the UI a practical item family without inventing product data."""
    compact_code = compact(code)
    context = " ".join(page_texts).lower()
    if section_id in {"holders", "hydraulic"} or any(token in compact_code for token in ("hsk", "bt", "sk", "cat", "iso", "abt", "collet", "chuck")):
        return "Tool holder / adapter"
    if any(compact_code.startswith(prefix.lower()) for prefix in INSERT_PREFIXES) or "insert" in context[:1600]:
        return "Insert"
    if section_id in {"drilling", "crown", "gundrills", "bta"}:
        return "Drill / deep-hole tool"
    if section_id in {"milling", "endmills"}:
        return "Milling tool"
    if section_id == "threading":
        return "Threading tool"
    if section_id == "grooving":
        return "Grooving / parting tool"
    return "Catalogue item"


def grades_from_pages(page_texts: list[str]) -> list[str]:
    grades = []
    seen = set()
    for page_text in page_texts:
        for raw in GRADE_RE.findall(page_text):
            grade = re.sub(r"\s+", "", raw).upper()
            if grade not in seen:
                seen.add(grade)
                grades.append(grade)
    return grades[:16]


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = value.replace("Ý", "tt")
    value = value.replace("ﬁ", "fi").replace("ﬂ", "fl").replace("ﬀ", "ff").replace("ﬃ", "ffi")
    value = value.replace("\uf001", "1").replace("\uf002", "2")
    value = value.replace("\r", "")
    return value


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", clean_text(value).lower())


def section_for(page_number: int) -> dict:
    for key, title, start, end, description in SECTIONS:
        if start <= page_number <= end:
            return {"id": key, "title": title, "startPage": start, "endPage": end, "description": description}
    if page_number < 3:
        return {"id": "frontmatter", "title": "Master Catalogue", "startPage": 1, "endPage": 2, "description": "Catalogue overview and contents"}
    return {"id": "backmatter", "title": "Master Catalogue", "startPage": 622, "endPage": 622, "description": "Catalogue closing page"}


def title_for(page_number: int, text: str, section: dict) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if not line.startswith("UNITEC |") and not line.startswith("UNITEC INDIA")]
    if page_number == 1:
        return "Master Catalogue 2026-27"
    if page_number == 2:
        return "Contents"
    if page_number in {3, 65, 70, 81, 136, 206, 225, 262, 280, 318, 433, 547, 608}:
        return section["title"]
    short_lines = [line for line in lines[:15] if 4 <= len(line) <= 55 and not line.startswith("www.")]
    if short_lines:
        for line in short_lines:
            if line.upper() in {"CONTENTS", "INTRODUCTION", "GRADES", "CHIPBREAKER GUIDE", "INSERT RANGE", "APPLICATION", "DIMENSIONS", "REFERENCE"}:
                return line.title() if line.isupper() else line
    for line in lines[:18]:
        upper = line.upper()
        if any(marker in upper for marker in ("PRODUCT PAGE", "RANGE", "SERIES", "HOLDER", "DRILL", "INSERT", "MILL", "CHUCK", "THREAD", "CUTTING DATA", "REFERENCE", "APPLICATION", "CONTENTS")):
            if len(line) >= 4 and len(line) <= 75:
                return line
    for line in lines[:15]:
        if len(line) >= 5 and len(line) <= 100 and not re.fullmatch(r"[A-Z0-9 /&.-]+", line) is None:
            return line
    return f"{section['title']} · page {page_number}"


def extract_text(pdf_path: Path, temp_path: Path) -> str:
    result = subprocess.run(["pdftotext", "-layout", str(pdf_path), str(temp_path)], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "pdftotext failed")
    return temp_path.read_text(errors="ignore")


def code_records(page_text: str, page_number: int, section: dict) -> list[dict]:
    codes = []
    seen = set()
    for raw in CODE_RE.findall(page_text):
        code = raw.strip("-.,;:")
        if len(code) < 3 or code in BAD_CODES or code.isdigit() or code.endswith("PAGE"):
            continue
        # The catalogue uses all-caps product codes. Exclude ordinary all-caps words
        # unless they contain a digit or a product-style separator.
        if not any(ch.isdigit() for ch in code) and "-" not in code and "/" not in code:
            continue
        key = compact(code)
        if key in seen:
            continue
        seen.add(key)
        codes.append({"code": code, "compact": key, "page": page_number, "sectionId": section["id"]})
    return codes


def make_snippet(text: str, query: str = "") -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]
    if query:
        q = compact(query)
        for line in lines:
            if q and q in compact(line):
                return line[:260]
    return " ".join(lines[:3])[:260]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_catalogue.py <catalogue.pdf> <output.json>")
    pdf_path = Path(sys.argv[1]).expanduser().resolve()
    output_path = Path(sys.argv[2]).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.parent / "catalogue-extracted.txt"
    raw = extract_text(pdf_path, temp_path)
    raw_pages = raw.split("\f")
    if raw_pages and not raw_pages[-1].strip():
        raw_pages.pop()

    pages = []
    page_map: dict[int, dict] = {}
    all_codes: dict[str, dict] = {}
    page_code_keys: dict[int, list[str]] = defaultdict(list)
    for page_number, raw_page in enumerate(raw_pages, start=1):
        text = clean_text(raw_page).strip()
        section = section_for(page_number)
        codes = code_records(text, page_number, section)
        for entry in codes:
            if entry["compact"] not in all_codes:
                all_codes[entry["compact"]] = {"id": entry["compact"], "code": entry["code"], "sectionId": section["id"], "pages": []}
            all_codes[entry["compact"]]["pages"].append(page_number)
            page_code_keys[page_number].append(entry["compact"])
        page_record = {
            "id": f"page-{page_number}",
            "page": page_number,
            "sectionId": section["id"],
            "title": title_for(page_number, text, section),
            "snippet": make_snippet(text),
            "text": text,
            "search": compact(text),
            "codes": [entry["code"] for entry in codes],
        }
        pages.append(page_record)
        page_map[page_number] = page_record

    for item in all_codes.values():
        source_texts = [page_map[page]["text"] for page in item["pages"][:8]]
        item["kind"] = classify_item(item["code"], item["sectionId"], source_texts)
        item["catalogNo"] = item["code"]
        item["designation"] = item["code"]
        item["grades"] = [] if item["kind"] == "Tool holder / adapter" else grades_from_pages(source_texts)
        item["firstPage"] = min(item["pages"])

    # Add explicit catalogue language as searchable relationship hints. These are
    # used for explanatory labels in the UI; no compatibility is inferred beyond
    # words printed in the catalogue.
    relations = []
    relation_re = re.compile(r"(?:matching|fits|compatible|recommended|shared|see)\s+(?:the\s+)?([^\.\n]{4,180})", re.IGNORECASE)
    for page in pages:
        for match in relation_re.findall(page["text"]):
            label = re.sub(r"\s+", " ", match).strip(" -:;,.")
            if label:
                relations.append({"page": page["page"], "label": label[:180]})

    # Build a small, bidirectional recommendation graph from lines that the
    # catalogue itself labels as matching, fitting, compatible, or usable with.
    relations = []
    relation_line_re = re.compile(r"matching|fits|compatible|recommended|shared|see|use\s+with", re.IGNORECASE)
    for page in pages:
        for raw_line in page["text"].splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()
            if not line or not relation_line_re.search(line):
                continue
            relation_tokens = code_records(line, page["page"], section_for(page["page"]))
            target_ids = [token["compact"] for token in relation_tokens if token["compact"] in all_codes]
            for target_id in target_ids:
                for source_id in page_code_keys[page["page"]]:
                    if source_id != target_id:
                        relations.append({"from": source_id, "to": target_id, "page": page["page"], "label": line[:220]})

    unique_relations = []
    seen_relations = set()
    for relation in relations:
        key = (relation["from"], relation["to"], relation["page"], relation["label"])
        if key not in seen_relations:
            seen_relations.add(key)
            unique_relations.append(relation)
    relations = unique_relations

    holder_ids = {
        relation["to"]
        for relation in relations
        if re.search(r"holder|boring bar|adapter|chuck|tool body|blade", relation["label"], re.IGNORECASE)
    }
    for item in all_codes.values():
        if item["id"] in holder_ids:
            item["kind"] = "Tool holder / adapter"
            item["grades"] = []

    sections = [{"id": key, "title": title, "startPage": start, "endPage": end, "description": description} for key, title, start, end, description in SECTIONS]
    sections.insert(0, {"id": "frontmatter", "title": "Master Catalogue", "startPage": 1, "endPage": 2, "description": "Catalogue overview and contents"})
    sections.append({"id": "backmatter", "title": "Master Catalogue", "startPage": 622, "endPage": 622, "description": "Catalogue closing page"})

    data = {
        "source": pdf_path.name,
        "pageCount": len(pages),
        "generatedFrom": str(pdf_path),
        "sections": sections,
        "pages": pages,
        "items": list(all_codes.values()),
        "relations": relations,
        "coverage": {
            "indexedPages": len(pages),
            "indexedIdentifiers": len(all_codes),
            "pagesWithIdentifiers": sum(1 for page in pages if page["codes"]),
        },
    }
    output_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    temp_path.unlink(missing_ok=True)
    print(json.dumps(data["coverage"]))


if __name__ == "__main__":
    main()
