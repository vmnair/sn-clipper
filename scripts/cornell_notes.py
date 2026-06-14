#!/usr/bin/env python3
"""
Supernote Manta — Cornell Notes Template
==========================================

Single-page Cornell Notes PDF optimized for Supernote Manta.

Layout:
  ┌─────────────────────────────────────────┐
  │ TOPIC _______________    DATE: ________ │
  ├────────────┬────────────────────────────┤
  │            │                            │
  │   CUE /   │        NOTES               │
  │ QUESTIONS  │                            │
  │            │   (ruled lines)            │
  │            │                            │
  ├────────────┴────────────────────────────┤
  │ SUMMARY                                 │
  │ (ruled lines)                           │
  └─────────────────────────────────────────┘

Usage:
  1. Edit configuration below if needed
  2. Run:  python cornell_notes.py
  3. Transfer PDF to Supernote, convert to template

Requirements:
  pip install reportlab
"""

import os
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Poppins Light fonts
pdfmetrics.registerFont(TTFont('Poppins-Light',
    '/usr/share/fonts/truetype/google-fonts/Poppins-Light.ttf'))
pdfmetrics.registerFont(TTFont('Poppins-LightItalic',
    '/usr/share/fonts/truetype/google-fonts/Poppins-LightItalic.ttf'))

FONT = 'Poppins-Light'
FONT_ITALIC = 'Poppins-LightItalic'


# ┌──────────────────────────────────────────────────────────────────┐
# │                       CONFIGURATION                              │
# └──────────────────────────────────────────────────────────────────┘

OUTPUT_FILE = "Cornell_Notes.pdf"

# Page size (Supernote Manta)
PAGE_W = 6.2 * inch
PAGE_H = 8.3 * inch

# Margins
MARGIN = 0.3 * inch
TOOLBAR_TOP = 0.35 * inch       # top offset for Supernote toolbar
TOOLBAR_LEFT = 0.25 * inch      # left offset for Supernote side menu

# Layout proportions
CUE_WIDTH_RATIO = 0.30          # 30% cue, 70% notes
SUMMARY_HEIGHT_RATIO = 0.20     # 20% of usable height for summary

# Line spacing (same as actions table in meeting planner)
ROW_HEIGHT = 20

# Colors — slightly darker lines than meeting planner
CLR_BLACK = black
CLR_GRAY = Color(0.5, 0.5, 0.5)          # labels, borders
CLR_GRAY_LINE = Color(0.65, 0.65, 0.65)  # ruled lines (darker than before)
CLR_GRAY_LABEL = Color(0.55, 0.55, 0.55) # section labels

# ┌──────────────────────────────────────────────────────────────────┐
# │                    END OF CONFIGURATION                          │
# └──────────────────────────────────────────────────────────────────┘


class CornellNotes:
    def __init__(self):
        self.c = canvas.Canvas(OUTPUT_FILE, pagesize=(PAGE_W, PAGE_H))
        self.c.setTitle("Cornell Notes")
        self.L = MARGIN
        self.R = PAGE_W - MARGIN
        self.w = self.R - self.L

    def _text(self, x, y, text, font=FONT, size=9, color=CLR_BLACK):
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawString(x, y, text)

    def _line(self, x1, y1, x2, y2, color=CLR_GRAY, width=0.5):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(width)
        self.c.line(x1, y1, x2, y2)

    def build(self):
        top = PAGE_H - MARGIN - TOOLBAR_TOP
        bottom = MARGIN
        usable_h = top - bottom

        # ══════════════════════════════════════════════════════════
        #  HEADER: TOPIC and DATE
        # ══════════════════════════════════════════════════════════

        y = top

        # TOPIC (left) and DATE (right) on same line
        self._text(self.L + 3, y - 10, "TOPIC",
                   FONT, 9, CLR_BLACK)
        topic_w = self.c.stringWidth("TOPIC", FONT, 9)
        topic_line_end = self.L + self.w * 0.60
        self._line(self.L + 3 + topic_w + 5, y - 12,
                   topic_line_end, y - 12, CLR_GRAY_LINE, 0.4)

        date_x = self.L + self.w * 0.65
        self._text(date_x, y - 10, "DATE:",
                   FONT, 9, CLR_BLACK)
        date_w = self.c.stringWidth("DATE:", FONT, 9)
        self._line(date_x + date_w + 5, y - 12,
                   self.R, y - 12, CLR_GRAY_LINE, 0.4)

        y -= 18

        # Header bottom border
        self._line(self.L, y, self.R, y, CLR_GRAY, 0.5)

        header_bottom = y

        # ══════════════════════════════════════════════════════════
        #  Calculate section boundaries
        # ══════════════════════════════════════════════════════════

        body_h = header_bottom - bottom
        summary_h = body_h * SUMMARY_HEIGHT_RATIO
        summary_top = bottom + summary_h

        # Summary top border
        self._line(self.L, summary_top, self.R, summary_top, CLR_GRAY, 0.5)

        # Cue/Notes vertical divider
        cue_right = self.L + self.w * CUE_WIDTH_RATIO
        self._line(cue_right, header_bottom, cue_right, summary_top, CLR_GRAY, 0.5)

        # ══════════════════════════════════════════════════════════
        #  CUE column (left) — label only, no ruled lines
        # ══════════════════════════════════════════════════════════

        self._text(self.L + 3, header_bottom - 14, "CUE / QUESTIONS",
                   FONT, 8, CLR_GRAY_LABEL)

        # ══════════════════════════════════════════════════════════
        #  NOTES column (right) — ruled lines
        # ══════════════════════════════════════════════════════════

        self._text(cue_right + 5, header_bottom - 14, "NOTES",
                   FONT, 8, CLR_GRAY_LABEL)

        # Ruled lines in notes area
        # Calculate start so lines end evenly above summary border
        notes_left = cue_right + 3
        notes_right = self.R
        available = header_bottom - summary_top
        num_lines = int(available / ROW_HEIGHT) - 1
        # Start lines so the last line sits exactly ROW_HEIGHT above summary
        first_line = summary_top + num_lines * ROW_HEIGHT
        ry = first_line
        while ry > summary_top + 5:
            self._line(notes_left, ry, notes_right, ry, CLR_GRAY_LINE, 0.4)
            ry -= ROW_HEIGHT

        # ══════════════════════════════════════════════════════════
        #  SUMMARY section (bottom) — ruled lines
        # ══════════════════════════════════════════════════════════

        self._text(self.L + 3, summary_top - 14, "SUMMARY",
                   FONT, 8, CLR_GRAY_LABEL)

        sy = summary_top - ROW_HEIGHT
        while sy > bottom + 5:
            self._line(self.L, sy, self.R, sy, CLR_GRAY_LINE, 0.4)
            sy -= ROW_HEIGHT

        # ══════════════════════════════════════════════════════════
        #  Outer border
        # ══════════════════════════════════════════════════════════

        self.c.setStrokeColor(CLR_GRAY)
        self.c.setLineWidth(0.5)
        self.c.rect(self.L, bottom, self.w, header_bottom - bottom,
                    stroke=1, fill=0)

        # Save
        self.c.save()
        size = os.path.getsize(OUTPUT_FILE)
        print(f"✓ Saved: {OUTPUT_FILE}")
        print(f"✓ Size:  {size / 1024:.0f} KB")


if __name__ == "__main__":
    CornellNotes().build()
