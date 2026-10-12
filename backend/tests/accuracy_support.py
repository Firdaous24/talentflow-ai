"""Authored fictional rows and ground truth; rendering never calls parser rules."""
import html
import json
from pathlib import Path
import pymupdf

REGRESSION_FIXTURES = json.loads((Path(__file__).parent / 'fixtures/accuracy_regression.json').read_text(encoding='utf-8'))

def make_accuracy_pdf(fixture: dict) -> bytes:
    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        for row in fixture['rows']:
            def draw(text, x, y, width, size, bold=False):
                content = f'<span>{html.escape(text)}</span>'
                css = f'* {{margin:0;padding:0;font-family:sans-serif;font-size:{size}pt;font-weight:{"bold" if bold else "normal"};line-height:1.05}}'
                result = page.insert_htmlbox(pymupdf.Rect(x, y, x + width, y + 28), content, css=css, scale_low=1)
                assert result[0] >= 0, f"Fictional row does not fit: {fixture['id']}"
            draw(row['text'], row.get('x', 40), row['y'], row.get('width', 515), row.get('size', 8.5), row.get('bold', False))
            if row.get('date'):
                draw(row['date'], 415, row['y'] + row.get('date_offset', 0), 140, 8)
        document.subset_fonts()
        return document.tobytes(garbage=4, deflate=True)
