import re
import html

def slugify(text: str) -> str:
    chars = [ch.lower() if ch.isalnum() else "_" for ch in text]
    raw = "".join(chars)
    while "__" in raw:
        raw = raw.replace("__", "_")
    return raw.strip("_")

def strip_html(raw: str) -> str:
    return re.sub(r"<[^>]+>", " ", raw or "")

def as_html(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return "<p></p>"
    if re.search(r"<\s*(p|ul|ol|li|h1|h2|h3|h4|blockquote|strong|em)\b", raw, flags=re.IGNORECASE):
        return raw

    lines = [ln.strip() for ln in raw.replace("\r", "").split("\n") if ln.strip()]
    if not lines:
        return f"<p>{html.escape(raw, quote=False)}</p>"

    blocks: list[str] = []
    list_items: list[str] = []

    def flush_list() -> None:
        nonlocal list_items
        if list_items:
            blocks.append("<ul>" + "".join(f"<li>{item}</li>" for item in list_items) + "</ul>")
            list_items = []

    for line in lines:
        if line.startswith("- "):
            list_items.append(html.escape(line[2:].strip(), quote=False))
        else:
            flush_list()
            blocks.append(f"<p>{html.escape(line, quote=False)}</p>")
    flush_list()
    return "".join(blocks)
