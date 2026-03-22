"""
RTD pre-build script.

Copies src/assets/docs/v1.0.0/ to rtd/_build/docs/, transforms custom
markdown syntax to MkDocs-compatible format, and generates the nav
section in mkdocs.yml.
"""

import re
import shutil
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_SRC = REPO_ROOT / "src" / "assets" / "docs" / "v1.0.0"
BUILD_DIR = REPO_ROOT / "rtd" / "_build" / "docs"
RTD_INDEX = REPO_ROOT / "rtd" / "index.md"
MKDOCS_YML = REPO_ROOT / "mkdocs.yml"

# Maps (callout_type, is_breaking) to (admonition_type, title)
CALLOUT_MAP = {
    ("new", False): ("success", "New"),
    ("new", True): ("danger", "Breaking Change"),
    ("updated", False): ("info", "Updated"),
    ("deprecated", False): ("warning", "Deprecated"),
    ("planned", False): ("abstract", "Planned"),
    ("tip", False): ("tip", ""),
}

CALLOUT_OPEN_RE = re.compile(
    r'^:::(new|updated|deprecated|planned|tip)(\{type="breaking"\})?\s*$'
)
CALLOUT_CLOSE_RE = re.compile(r"^:::\s*$")
CODE_FENCE_RE = re.compile(r"^(`{3,})")
CODE_META_RE = re.compile(r"^(```\w+)\{.+\}$", re.MULTILINE)


def clean_and_copy():
    """Copy docs source to build dir and remove _folder.md files."""
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    shutil.copytree(DOCS_SRC, BUILD_DIR)
    shutil.copy2(RTD_INDEX, BUILD_DIR / "index.md")

    for f in BUILD_DIR.rglob("_folder.md"):
        f.unlink()

    # Remove README.md from root if present (we have our own index.md)
    readme = BUILD_DIR / "README.md"
    if readme.exists():
        readme.unlink()


def convert_callouts(text: str) -> str:
    """Convert custom :::callout syntax to MkDocs admonitions."""
    lines = text.split("\n")
    result = []
    i = 0
    in_code_block = False
    code_fence_marker = None

    while i < len(lines):
        line = lines[i]

        # Track fenced code blocks to avoid transforming inside them
        fence_match = CODE_FENCE_RE.match(line)
        if fence_match:
            marker = fence_match.group(1)
            if not in_code_block:
                in_code_block = True
                code_fence_marker = marker
            elif line.strip() == code_fence_marker:
                in_code_block = False
                code_fence_marker = None

        if in_code_block:
            result.append(line)
            i += 1
            continue

        # Check for callout opening
        m = CALLOUT_OPEN_RE.match(line)
        if m:
            tag = m.group(1)
            is_breaking = m.group(2) is not None
            key = (tag, is_breaking)
            admon_type, title = CALLOUT_MAP.get(key, ("note", ""))

            if title:
                result.append(f'!!! {admon_type} "{title}"')
            else:
                result.append(f"!!! {admon_type}")

            i += 1
            # Collect body until closing :::
            while i < len(lines) and not CALLOUT_CLOSE_RE.match(lines[i]):
                body_line = lines[i]
                if body_line.strip():
                    result.append(f"    {body_line}")
                else:
                    result.append("")
                i += 1
            # Skip closing :::
            if i < len(lines):
                i += 1
        else:
            result.append(line)
            i += 1

    return "\n".join(result)


def strip_code_metadata(text: str) -> str:
    """Strip custom metadata from code fence opening lines."""
    return CODE_META_RE.sub(r"\1", text)


def transform_file(filepath: Path):
    """Apply all transformations to a markdown file."""
    text = filepath.read_text(encoding="utf-8")
    text = convert_callouts(text)
    text = strip_code_metadata(text)
    filepath.write_text(text, encoding="utf-8")


def parse_frontmatter(filepath: Path) -> dict:
    """Extract YAML frontmatter from a markdown file."""
    text = filepath.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    try:
        end = text.index("---", 3)
        return yaml.safe_load(text[3:end]) or {}
    except (ValueError, yaml.YAMLError):
        return {}


def build_nav(directory: Path, rel_path: str = "") -> list:
    """Recursively build MkDocs nav structure from _folder.md ordering."""
    entries = []

    # Collect subdirectories with order from their _folder.md
    subdirs = []
    for d in sorted(directory.iterdir()):
        if not d.is_dir():
            continue
        folder_md = d / "_folder.md"
        if folder_md.exists():
            fm = parse_frontmatter(folder_md)
        else:
            fm = {}
        subdirs.append((fm.get("order", 99), fm.get("title", d.name.replace("-", " ").title()), d))
    subdirs.sort(key=lambda x: x[0])

    # Collect files with order from frontmatter
    files = []
    for f in directory.glob("*.md"):
        if f.name in ("_folder.md", "README.md"):
            continue
        fm = parse_frontmatter(f)
        file_rel = f"{rel_path}/{f.name}" if rel_path else f.name
        files.append((fm.get("order", 99), fm.get("title", f.stem.replace("-", " ").title()), file_rel))
    files.sort(key=lambda x: x[0])

    # Files first, then subdirs
    for _, title, file_path in files:
        entries.append({title: file_path})

    for _, title, subdir in subdirs:
        sub_rel = f"{rel_path}/{subdir.name}" if rel_path else subdir.name
        sub_entries = build_nav(subdir, sub_rel)
        if sub_entries:
            entries.append({title: sub_entries})

    return entries


def quote_if_needed(s: str) -> str:
    """Quote a YAML string if it contains special characters."""
    if any(c in s for c in ":#{}[]|>&*!%@`"):
        return f"'{s}'"
    return s


def format_nav_yaml(nav: list, indent: int = 0) -> str:
    """Format nav list as YAML string."""
    lines = []
    prefix = "  " * indent
    for item in nav:
        if isinstance(item, dict):
            for key, value in item.items():
                quoted_key = quote_if_needed(key)
                if isinstance(value, list):
                    lines.append(f"{prefix}- {quoted_key}:")
                    lines.append(format_nav_yaml(value, indent + 2))
                else:
                    lines.append(f"{prefix}- {quoted_key}: {value}")
        else:
            lines.append(f"{prefix}- {item}")
    return "\n".join(lines)


def update_mkdocs_yml(nav: list):
    """Update mkdocs.yml by appending nav section as text (avoids yaml.safe_load
    issues with !!python/name tags)."""
    text = MKDOCS_YML.read_text(encoding="utf-8")

    # Remove existing nav section if present
    text = re.sub(r"\nnav:.*", "", text, flags=re.DOTALL)

    full_nav = [{"Home": "index.md"}] + nav
    nav_yaml = format_nav_yaml(full_nav)
    text = text.rstrip() + "\n\nnav:\n" + nav_yaml + "\n"

    MKDOCS_YML.write_text(text, encoding="utf-8")


def main():
    print("RTD build: copying docs...")
    clean_and_copy()

    print("RTD build: transforming markdown...")
    for md_file in BUILD_DIR.rglob("*.md"):
        transform_file(md_file)

    print("RTD build: generating nav...")
    nav = build_nav(DOCS_SRC)
    update_mkdocs_yml(nav)

    doc_count = len(list(BUILD_DIR.rglob("*.md")))
    print(f"RTD build: complete ({doc_count} docs)")


if __name__ == "__main__":
    main()
