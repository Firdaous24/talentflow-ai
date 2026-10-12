"""Geometry-based regions; never globally interleave two columns by y coordinate."""
from dataclasses import dataclass
from statistics import median
from app.services.sections import section_heading

@dataclass(frozen=True)
class Span:
    text: str
    bbox: tuple[float, float, float, float]
    size: float
    flags: int
    font: str

@dataclass(frozen=True)
class LayoutLine:
    id: str
    text: str
    page: int
    bbox: tuple[float, float, float, float]
    spans: tuple[Span, ...]
    region: int = 0

def visual_rows(lines: list[LayoutLine]) -> list[LayoutLine]:
    """Co-baseline fragments read left-to-right despite tiny font/y offsets.

    Called only inside an already chosen region; never across content columns.
    """
    rows: list[list[LayoutLine]] = []
    for line in sorted(lines, key=lambda v: (v.bbox[1], v.bbox[0])):
        tolerance = max(1.5, min((span.size for span in line.spans), default=10) * .35)
        if rows and abs(line.bbox[1] - rows[-1][0].bbox[1]) <= tolerance and all(line.bbox[0] >= v.bbox[2] - 1 or v.bbox[0] >= line.bbox[2] - 1 for v in rows[-1]):
            rows[-1].append(line)
        else:
            rows.append([line])
    return [line for row in rows for line in sorted(row, key=lambda v: v.bbox[0])]

def page_lines(page, normalize) -> tuple[list[LayoutLine], list[str]]:
    lines, warnings = [], []
    # Exclude image bytes; retain block, line, span, font and geometry information.
    import pymupdf
    blocks = page.get_text('dict', flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)['blocks']
    for b, block in enumerate(blocks):
        for l, line in enumerate(block.get('lines', [])):
            if abs(line.get('dir', (1, 0))[1]) > .2:
                warnings.append('Rotated text was omitted; review the original document.')
                continue
            groups: list[list[Span]] = [[]]
            for raw in sorted(line['spans'], key=lambda s: s['bbox'][0]):
                span = Span(raw['text'], tuple(raw['bbox']), raw['size'], raw['flags'], raw['font'])
                if groups[-1] and span.bbox[0] - groups[-1][-1].bbox[2] > max(25, span.size * 3):
                    groups.append([])
                groups[-1].append(span)
            for s, group in enumerate(groups):
                text = normalize(' '.join(span.text for span in group))
                if not text:
                    continue
                bbox = (min(v.bbox[0] for v in group), min(v.bbox[1] for v in group), max(v.bbox[2] for v in group), max(v.bbox[3] for v in group))
                lines.append(LayoutLine(f'p{page.number + 1}-b{b}-l{l}-g{s}', text, page.number + 1, bbox, tuple(group)))
    return lines, warnings

def reading_order(lines: list[LayoutLine], width: float) -> tuple[list[LayoutLine], list[str]]:
    from dataclasses import replace
    if not lines:
        return [], []
    headings = [line.bbox[1] for line in lines if section_heading(line.text)[0] is not None]
    body_top = min(headings) if headings else min(line.bbox[1] for line in lines)
    header = [line for line in lines if line.bbox[1] < body_top - 2]
    body = [line for line in lines if line not in header]
    starts = sorted(line.bbox[0] for line in body)
    gaps = [(starts[i + 1] - starts[i], (starts[i + 1] + starts[i]) / 2) for i in range(len(starts) - 1)]
    cuts = [cut for gap, cut in gaps if gap >= width * .18 and width * .2 < cut < width * .8]
    cut = None
    for candidate in cuts:
        left = [v for v in body if v.bbox[0] < candidate]
        right = [v for v in body if v.bbox[0] >= candidate]
        crosses = [v for v in left if v.bbox[2] > candidate + 5]
        from app.services.multilingual import date_range
        if right and sum(bool(date_range(v.text)[0]) for v in right) >= len(right) * .7:
            # Right-aligned dates in a one-column CV are row annotations.
            continue
        if len(left) >= 3 and len(right) >= 3 and len(crosses) <= max(1, len(body) * .15):
            cut = candidate
            break
    ordered = visual_rows(header)
    warnings = []
    if cut is None:
        return ordered + visual_rows(body), warnings
    # Wide lines split the page into horizontal bands. Within a band read each
    # entire column, resetting section context at each region boundary.
    wide = sorted([v for v in body if v.bbox[0] < cut and v.bbox[2] > cut + 5], key=lambda v: v.bbox[1])
    remaining = [v for v in body if v not in wide]
    region = 1
    for separator in [*wide, None]:
        bottom = separator.bbox[1] if separator else float('inf')
        band = [v for v in remaining if v.bbox[1] < bottom]
        remaining = [v for v in remaining if v not in band]
        for column in ([v for v in band if v.bbox[0] < cut], [v for v in band if v.bbox[0] >= cut]):
            ordered.extend(replace(v, region=region) for v in visual_rows(column))
            region += 1
        if separator:
            ordered.append(replace(separator, region=region)); region += 1
    warnings.append('Two-column reading order was inferred from geometry; review section and entry associations.')
    return ordered, warnings

def layout_text(lines: list[LayoutLine]) -> str:
    output, previous = [], None
    typical = median([span.size for line in lines for span in line.spans]) if lines else 10
    for line in lines:
        if previous and (line.page, line.region) != (previous.page, previous.region):
            output.append('[[REGION]]' if line.region != previous.region else '\f')
        elif previous and line.bbox[1] - previous.bbox[3] > typical * .9:
            output.append('')
        output.append(line.text)
        previous = line
    return '\n'.join(output)
