#!/usr/bin/env python3
"""
Supernote Manta — Meeting Planner Template
"""

import os
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Poppins Light fonts
pdfmetrics.registerFont(TTFont('Poppins-Light',
    '/usr/share/fonts/truetype/google-fonts/Poppins-Light.ttf'))
pdfmetrics.registerFont(TTFont('Poppins-LightItalic',
    '/usr/share/fonts/truetype/google-fonts/Poppins-LightItalic.ttf'))

FONT = 'Poppins-Light'
FONT_ITALIC = 'Poppins-LightItalic'

OUTPUT_FILE = "Meeting_Planner.pdf"

PAGE_W = 6.2 * inch
PAGE_H = 8.3 * inch
MARGIN = 0.3 * inch

ATTENDEE_ROWS = 6
AGENDA_ROWS = 6
ACTION_ROWS = 10

CHECKBOX_SIZE = 9
ROW_HEIGHT = 20

CLR_BLACK = black
CLR_WHITE = white
CLR_GRAY = Color(0.6, 0.6, 0.6)
CLR_GRAY_LIGHT = Color(0.78, 0.78, 0.78)
CLR_GRAY_ICON = Color(0.7, 0.7, 0.7)


class MeetingPlanner:
    def __init__(self):
        self.c = canvas.Canvas(OUTPUT_FILE, pagesize=(PAGE_W, PAGE_H))
        self.c.setTitle("Meeting Planner")
        left_margin = MARGIN + 0.25 * inch  # extra offset for Supernote left toolbar
        self.w = PAGE_W - left_margin - MARGIN
        self.L = left_margin
        self.R = PAGE_W - MARGIN

    def _text(self, x, y, text, font=FONT, size=9, color=CLR_BLACK):
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawString(x, y, text)

    def _text_c(self, x, y, text, font=FONT, size=9, color=CLR_BLACK):
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        tw = self.c.stringWidth(text, font, size)
        self.c.drawString(x - tw / 2, y, text)

    def _line(self, x1, y1, x2, y2, color=CLR_GRAY, width=0.5):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(width)
        self.c.line(x1, y1, x2, y2)

    def _hline(self, y):
        self._line(self.L, y, self.R, y, CLR_GRAY, 0.5)

    def _checkbox(self, x, y, size=None):
        sz = size or CHECKBOX_SIZE
        self.c.setStrokeColor(CLR_GRAY)
        self.c.setLineWidth(0.5)
        self.c.rect(x, y, sz, sz, stroke=1, fill=0)

    def _note_icon(self, x, y, size=16):
        """Outline note/page icon (not filled)."""
        s = size
        # Page outline
        self.c.setStrokeColor(CLR_GRAY)
        self.c.setLineWidth(0.5)
        self.c.rect(x, y, s, s * 1.2, stroke=1, fill=0)
        # Small lines on the page
        self.c.setLineWidth(0.4)
        for i in range(3):
            ly = y + s * 0.25 + i * s * 0.28
            self.c.line(x + s * 0.2, ly, x + s * 0.8, ly)

    def build(self):
        y = PAGE_H - MARGIN - 0.35 * inch  # extra offset for Supernote toolbar
        rh = ROW_HEIGHT

        # ──────────────────────────────────────────────────────────
        #  ROW 1: "Meeting Planner" (gray italic) + note icon | DATE:
        #
        #  Original layout:
        #    Meeting Planner  [N]              DATE:
        #                                      _______________
        # ──────────────────────────────────────────────────────────

        # Title in gray italic
        self._text(self.L, y - 16, "Meeting Planner",
                   FONT_ITALIC, 18, CLR_GRAY)

        # DATE: top right
        date_label_x = self.R - 95
        self._text(date_label_x, y - 10, "DATE:",
                   FONT, 9, CLR_BLACK)

        y -= 14

        # Line under DATE for writing
        date_line_y = y
        self._line(date_label_x, date_line_y, self.R, date_line_y)

        # M T W T F S S — plain letters, right under DATE line
        days = ["M", "T", "W", "T", "F", "S", "S"]
        day_spacing = 14
        days_total = len(days) * day_spacing
        dstart = self.R - days_total + day_spacing / 2
        for i, d in enumerate(days):
            dx = dstart + i * day_spacing
            self._text_c(dx, date_line_y - 11, d, FONT, 8, CLR_GRAY)

        # ──────────────────────────────────────────────────────────
        #  ROW 2: TIME START: _____ TIME END: | M T W T F S S
        # ──────────────────────────────────────────────────────────

        y -= 4

        self._text(self.L, y - 10, "TIME START:",
                   FONT, 9, CLR_BLACK)

        self._text(self.L + 85, y - 10, "TIME END:",
                   FONT, 9, CLR_BLACK)

        # Single continuous line under both
        y -= 14
        self._line(self.L, y, self.L + self.w * 0.50 - 8, y, CLR_GRAY_LIGHT, 0.4)

        y -= 8

        # ──────────────────────────────────────────────────────────
        #  ROW 3: TOPIC _________ | OBJECTIVE _________
        # ──────────────────────────────────────────────────────────

        mid = self.L + self.w * 0.50

        y -= 1

        # TOPIC label
        self._text(self.L + 3, y - 10, "TOPIC",
                   FONT, 9, CLR_BLACK)

        # OBJECTIVE label
        self._text(mid + 8, y - 10, "OBJECTIVE",
                   FONT, 9, CLR_BLACK)

        # Write-on line below TOPIC (left half)
        y -= 14
        self._line(self.L, y, mid - 8, y, CLR_BLACK, 0.5)

        # Write-on line below OBJECTIVE (right half)
        self._line(mid + 8, y, self.R, y, CLR_BLACK, 0.5)

        # Second set of write-on lines
        y -= 14
        self._line(self.L, y, mid - 8, y, CLR_GRAY_LIGHT, 0.4)
        self._line(mid + 8, y, self.R, y, CLR_GRAY_LIGHT, 0.4)

        # In Person / Online checkboxes between 2nd and 3rd lines (left half only)
        cb_y = y - 14 / 2 - CHECKBOX_SIZE / 2
        self._checkbox(self.L + 5, cb_y)
        self._text(self.L + 5 + CHECKBOX_SIZE + 5, cb_y + 1,
                   "In Person", FONT, 9, CLR_BLACK)

        self._checkbox(self.L + 120, cb_y)
        self._text(self.L + 120 + CHECKBOX_SIZE + 5, cb_y + 1,
                   "Online", FONT, 9, CLR_BLACK)

        # Third set of write-on lines
        y -= 14
        self._line(self.L, y, mid - 8, y, CLR_BLACK, 0.5)
        self._line(mid + 8, y, self.R, y, CLR_GRAY_LIGHT, 0.4)

        # ──────────────────────────────────────────────────────────
        #  ROWS 5–10: ATTENDEES (left) | AGENDA ITEMS (right)
        # ──────────────────────────────────────────────────────────

        att_w = self.w * 0.38
        mid_x = self.L + att_w

        y -= 3
        self._text(self.L + 3, y - 11, "ATTENDEES",
                   FONT, 9, CLR_BLACK)
        self._text(mid_x + 10, y - 11, "AGENDA ITEMS",
                   FONT, 9, CLR_BLACK)
        y -= 15
        self._line(self.L, y, mid_x - 3, y, CLR_GRAY, 0.5)
        self._line(mid_x + 3, y, self.R, y, CLR_GRAY, 0.5)

        for i in range(max(ATTENDEE_ROWS, AGENDA_ROWS)):
            ry = y - (i + 1) * rh
            cb_yp = ry + (rh - 8) / 2

            if i < ATTENDEE_ROWS:
                self._checkbox(self.L + 5, cb_yp, 8)
                self._line(self.L, ry, mid_x - 3, ry, CLR_GRAY_LIGHT, 0.4)

            if i < AGENDA_ROWS:
                self._checkbox(mid_x + 10, cb_yp, 8)
                self._line(mid_x + 3, ry, self.R, ry, CLR_GRAY_LIGHT, 0.4)

        section_bottom = y - max(ATTENDEE_ROWS, AGENDA_ROWS) * rh
        y = section_bottom - 12

        # ──────────────────────────────────────────────────────────
        #  NOTES section
        # ──────────────────────────────────────────────────────────

        y -= 3

        # NOTES label (left) + outline note icon (right)
        self._text(self.L + 3, y - 10, "NOTES",
                   FONT, 9, CLR_BLACK)
        self._note_icon(self.R - 14, y - 12, 10)

        # Ruled lines — fill available space above actions table
        # Actions table needs: 2 (gap) + 18 (header) + ACTION_ROWS * ROW_HEIGHT + margin
        actions_height = 2 + 18 + ACTION_ROWS * rh
        notes_bottom = MARGIN + actions_height + 4
        y -= rh
        while y > notes_bottom:
            self._line(self.L, y, self.R, y, CLR_GRAY_LIGHT, 0.4)
            y -= rh

        # ──────────────────────────────────────────────────────────
        #  ACTIONS TABLE: ACTIONS | WHO | DUE | ✓
        # ──────────────────────────────────────────────────────────

        col_a = self.w * 0.52
        col_w = self.w * 0.20
        col_d = self.w * 0.18
        col_c = self.w * 0.10

        cx1 = self.L + col_a
        cx2 = cx1 + col_w
        cx3 = cx2 + col_d

        # Header row
        y -= 2
        hh = 18
        hbot = y - hh

        self._text_c(self.L + col_a / 2, hbot + 5,
                     "ACTIONS", FONT, 9, CLR_BLACK)
        self._text_c(cx1 + col_w / 2, hbot + 5,
                     "WHO", FONT, 9, CLR_BLACK)
        self._text_c(cx2 + col_d / 2, hbot + 5,
                     "DUE", FONT, 9, CLR_BLACK)
        self._text_c(cx3 + col_c / 2, hbot + 5,
                     "✓", FONT, 9, CLR_BLACK)

        # Header borders
        self._line(self.L, y, self.R, y, CLR_GRAY, 0.5)
        self._line(self.L, hbot, self.R, hbot, CLR_GRAY, 0.5)
        for cx in [self.L, cx1, cx2, cx3, self.R]:
            self._line(cx, y, cx, hbot, CLR_GRAY, 0.5)

        y = hbot

        # Data rows
        for i in range(ACTION_ROWS):
            ry = y - (i + 1) * rh
            self._line(self.L, ry, self.R, ry, CLR_GRAY_LIGHT, 0.4)

            for cx in [cx1, cx2, cx3]:
                self._line(cx, y - i * rh, cx, ry, CLR_GRAY_LIGHT, 0.3)

            cb_sz = 8
            cbx = cx3 + (col_c - cb_sz) / 2
            cby = ry + (rh - cb_sz) / 2
            self._checkbox(cbx, cby, cb_sz)

        # Outer border
        tbot = y - ACTION_ROWS * rh
        self.c.setStrokeColor(CLR_GRAY)
        self.c.setLineWidth(0.5)
        self.c.rect(self.L, tbot, self.w, y - tbot, stroke=1, fill=0)
        self._line(self.L, y, self.L, tbot, CLR_GRAY, 0.5)
        self._line(self.R, y, self.R, tbot, CLR_GRAY, 0.5)

        # Save
        self.c.save()
        size = os.path.getsize(OUTPUT_FILE)
        print(f"✓ Saved: {OUTPUT_FILE}")
        print(f"✓ Size:  {size / 1024:.0f} KB")


if __name__ == "__main__":
    MeetingPlanner().build()
