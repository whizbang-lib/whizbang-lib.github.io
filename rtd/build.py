"""
RTD pre-build script.

Copies src/assets/docs/v1.0.0/ to rtd/_build/docs/, transforms custom
markdown syntax to MkDocs-compatible format, and generates the nav
section in mkdocs.yml.
"""

import json
import os
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
CODE_META_RE = re.compile(r'^(```\w+)\{([^}]+)\}', re.MULTILINE)
WB_VIDEO_RE = re.compile(r'<wb-video\s+id="([^"]+)"[^>]*>.*?</wb-video>', re.DOTALL)
WB_VIDEO_SELF_RE = re.compile(r'<wb-video\s+id="([^"]+)"[^/]*/>')
WB_EXAMPLE_RE = re.compile(r'<wb-example\s+id="([^"]+)"[^>]*>.*?</wb-example>', re.DOTALL)
WB_EXAMPLE_SELF_RE = re.compile(r'<wb-example\s+id="([^"]+)"[^/]*/>')
ANCHOR_ID_RE = re.compile(r'\s*\{#[\w-]+\}')
# A markdown link or image target: ](target) or ](target "title").
LINK_TARGET_RE = re.compile(r'(\]\()([^)\s]+)((?:\s+"[^"]*")?\))')
DOCS_ROOT = REPO_ROOT / "src" / "assets" / "docs"
SITE_DOCS_URL = "https://whizba.ng/docs/"


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
    """Strip custom metadata from code fence opening lines, preserving title as bold text."""

    def _replace_meta(m):
        fence = m.group(1)  # e.g., ```csharp
        meta = m.group(2)  # e.g., title="Example" description="..."
        title_match = re.search(r'title\s*=\s*"([^"]*)"', meta)
        if title_match:
            title = title_match.group(1)
            return f"**{title}**\n\n{fence}"
        return fence

    return CODE_META_RE.sub(_replace_meta, text)


def convert_custom_components(text: str) -> str:
    """Replace custom Angular components with plain-text fallbacks for RTD."""
    # <wb-video id="xyz"> → YouTube link
    text = WB_VIDEO_RE.sub(
        r'[:material-video: Watch on YouTube](https://www.youtube.com/watch?v=\1){.md-button}',
        text,
    )
    text = WB_VIDEO_SELF_RE.sub(
        r'[:material-video: Watch on YouTube](https://www.youtube.com/watch?v=\1){.md-button}',
        text,
    )
    # <wb-example id="xyz"> → StackBlitz link
    text = WB_EXAMPLE_RE.sub(
        r'[:material-code-tags: Open in StackBlitz](https://stackblitz.com/edit/\1){.md-button}',
        text,
    )
    text = WB_EXAMPLE_SELF_RE.sub(
        r'[:material-code-tags: Open in StackBlitz](https://stackblitz.com/edit/\1){.md-button}',
        text,
    )
    return text


def strip_anchor_ids(text: str) -> str:
    """Remove custom anchor IDs ({#some-id}) everywhere except on headings.

    On a heading, attr_list (enabled in mkdocs.yml) turns `## Title {#some-id}` into the anchor
    other pages link to, so it is kept; stripping it made MkDocs fall back to a slug of the title
    and broke every link to the custom id. Anywhere else the syntax is not an anchor and would
    render as text.
    """
    return "\n".join(line if line.lstrip().startswith("#") else ANCHOR_ID_RE.sub("", line)
                     for line in text.split("\n"))


def strip_lastmaintained(text: str) -> str:
    """Remove lastMaintainedCommit from frontmatter (internal-only field)."""
    return re.sub(r"^lastMaintainedCommit:.*\n", "", text, flags=re.MULTILINE)


def load_test_status() -> dict:
    """Load the committed live test-status index (produced by library CI via
    src/scripts/build-test-status.mjs). Returns {} when the pipeline hasn't
    published yet."""
    status_path = REPO_ROOT / "src" / "assets" / "data" / "test-status" / "index.json"
    if not status_path.exists():
        return {}
    try:
        return json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def inject_test_verification(text: str, filepath: Path, test_status: dict) -> str:
    """RTD is static, so inject a build-time 'verified by tests' admonition
    under the first H1 for pages carrying testReferences frontmatter."""
    if not text.startswith("---"):
        return text
    try:
        end = text.index("\n---", 3)
        fm = yaml.safe_load(text[3:end]) or {}
    except (ValueError, yaml.YAMLError):
        return text
    refs = fm.get("testReferences") or []
    if not refs:
        return text
    classes = [Path(r).stem for r in refs if str(r).endswith(".cs")]
    if not classes:
        return text
    run = (test_status or {}).get("run") or {}
    when = (run.get("completedAt") or "")[:10]
    run_note = f" — library CI run #{run['runId']} ({when})" if run.get("runId") else ""
    lines = ", ".join(f"`{c}`" for c in classes)
    admonition = f'\n!!! success "Verified by tests"\n    {lines}{run_note}\n'
    # Insert after the first H1 (or append after frontmatter when no H1).
    m = re.search(r"^# .+$", text, flags=re.MULTILINE)
    if m:
        pos = m.end()
        return text[:pos] + "\n" + admonition + text[pos:]
    return text + admonition


def resolve_doc_link(text: str, filepath: Path) -> str:
    """Make every docs link resolve on Read the Docs the way it does on the main site.

    The main site routes links without the .md extension ("json-contexts"), site-absolute links
    ("/v1.0.0/fundamentals/..."), and links into sections Read the Docs does not build (drafts/,
    contributors/). MkDocs resolves none of those, so on Read the Docs they were dead links:
      - a target inside the v1.0.0 tree becomes a relative link to its .md page;
      - a target in any other docs section becomes an absolute whizba.ng URL;
      - anything else (external URLs, in-page anchors, assets) is left as is.
    """
    source = DOCS_SRC / filepath.relative_to(BUILD_DIR)

    def _page(path: Path):
        # A folder's own page is its _folder.md (the site's section overview), which the build
        # drops, so a link to a folder resolves to the site rather than to nothing.
        for candidate in (path, path.with_name(path.name + ".md"), path / "README.md",
                          path / "_folder.md"):
            if candidate.is_file() and candidate.suffix == ".md":
                return candidate
        return None

    def _rewrite(m):
        target = m.group(2)
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
            return m.group(0)
        path, _, anchor = target.partition("#")
        if not path:
            return m.group(0)
        if path.startswith("/"):
            # Site-absolute: /v1.0.0/x, /docs/v1.0.0/x or /docs/drafts/x all name a docs page.
            rooted = path.removeprefix("/docs").lstrip("/")
            # Without a version or section, the site serves the current version (v1.0.0).
            page = _page((DOCS_ROOT / rooted).resolve()) or _page((DOCS_SRC / rooted).resolve())
        else:
            page = _page((source.parent / path).resolve())
        if page is None or not page.is_relative_to(DOCS_ROOT):
            return m.group(0)
        if page.is_relative_to(DOCS_SRC) and page.name != "_folder.md":
            new = Path(os.path.relpath(page, source.parent)).as_posix()
        else:
            rel = page.relative_to(DOCS_ROOT)
            rel = rel.parent if rel.name == "_folder.md" else rel.with_suffix("")
            new = SITE_DOCS_URL + rel.as_posix()
        if new == path:
            return m.group(0)
        return m.group(1) + new + ("#" + anchor if anchor else "") + m.group(3)

    return LINK_TARGET_RE.sub(_rewrite, text)


def transform_file(filepath: Path, test_status: dict = None):
    """Apply all transformations to a markdown file."""
    text = filepath.read_text(encoding="utf-8")
    text = inject_test_verification(text, filepath, test_status or {})
    text = strip_lastmaintained(text)
    text = convert_callouts(text)
    text = convert_custom_components(text)
    text = strip_code_metadata(text)
    text = strip_anchor_ids(text)
    if filepath.relative_to(BUILD_DIR) != Path("index.md"):
        text = resolve_doc_link(text, filepath)
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
        # The root README is replaced by rtd/index.md (clean_and_copy). A subfolder's README is
        # that section's landing page: it is built, so it belongs in the nav, first.
        if f.name == "_folder.md" or (f.name == "README.md" and not rel_path):
            continue
        fm = parse_frontmatter(f)
        file_rel = f"{rel_path}/{f.name}" if rel_path else f.name
        if f.name == "README.md":
            files.append((-1, fm.get("title", "Overview"), file_rel))
            continue
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
    """Quote a YAML string, doubling any single quote it contains.

    A single-quoted YAML scalar ends at the next apostrophe unless that
    apostrophe is doubled, so a title like "Declared Index Cannot Be Built For
    This Field's Type" terminated the string early and left the rest of the line
    as stray tokens. That makes the whole of mkdocs.yml unparseable, not just the
    one entry, which failed every Read the Docs build until the project was
    disabled for consecutive failures.
    """
    if not s:
        return "''"
    if any(c in s for c in ":#{}[]|>&*!%@`'\"") or s != s.strip():
        return "'" + s.replace("'", "''") + "'"
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
    test_status = load_test_status()
    for md_file in BUILD_DIR.rglob("*.md"):
        transform_file(md_file, test_status)

    print("RTD build: generating nav...")
    nav = build_nav(DOCS_SRC)
    update_mkdocs_yml(nav)

    doc_count = len(list(BUILD_DIR.rglob("*.md")))
    print(f"RTD build: complete ({doc_count} docs)")


if __name__ == "__main__":
    main()
