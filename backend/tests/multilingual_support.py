"""Fictional PDFs with independently authored ground truth; no binary fixtures."""
import json
from pathlib import Path
import pymupdf
from app.services.sections import section_heading

FIXTURES = json.loads((Path(__file__).parent / 'fixtures/multilingual.json').read_text(encoding='utf-8'))

def make_layout_pdf(fixture: dict) -> bytes:
    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        if fixture['name']:
            page.insert_text((40, 45), fixture['name'], fontsize=20, fontname='hebo')
        for i, text in enumerate(fixture['contact']):
            page.insert_text((40, 70 + i * 15), text, fontsize=10)
        for column, text in enumerate(fixture['columns']):
            x, y = (40 if column == 0 else 320), 135
            for line in text.splitlines():
                heading = section_heading(line)[0] is not None
                if line:
                    page.insert_text((x, y), line, fontsize=11 if heading else 9, fontname='hebo' if heading else 'helv')
                y += 19 if heading else 15
            assert y < 800
        return document.tobytes()
