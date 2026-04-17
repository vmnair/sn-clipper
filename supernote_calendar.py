#!/usr/bin/env python3
"""
Supernote Manta Calendar Generator
===================================

Generates a linked PDF calendar optimized for Supernote Manta e-ink tablet.

Structure (431 pages for a standard year):
  Page 1        : Year view — 12 mini-calendars with day links to day pages
  Pages 2–13    : Month views — full grids, days link to day pages
  Pages 14–66   : Week views — overview with ruled lines, day headers link to day pages
  Pages 67–431  : Day pages — task checkboxes on top, 9mm ruled notes below

Navigation icons on every page let you jump between views:
  Grid icon     → Year view
  Calendar icon → Month view
  Lines icon    → Week view
  < / >         → Previous / Next

Requirements:
  pip install reportlab

Usage:
  1. Edit the CONFIGURATION section below (year, holidays, sizing, etc.)
  2. Run:  python supernote_calendar.py
  3. Transfer the generated PDF to your Supernote Manta
"""

import calendar
import datetime
import os
from reportlab.lib.units import inch, mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, Color


# ┌──────────────────────────────────────────────────────────────────┐
# │                       CONFIGURATION                              │
# │                                                                  │
# │  Edit these values to customize your calendar.                   │
# │  You should NOT need to modify anything below this section.      │
# └──────────────────────────────────────────────────────────────────┘

# ── Calendar Year ─────────────────────────────────────────────────
YEAR = 2026

# ── Output File Path ──────────────────────────────────────────────
OUTPUT_FILE = f"{YEAR}_Supernote_Calendar.pdf"

# ── Page Size ─────────────────────────────────────────────────────
# Supernote Manta display: 1404×1872 px at ~226 DPI ≈ 6.2" × 8.3"
PAGE_W = 6.2 * inch
PAGE_H = 8.3 * inch

# ── Layout Spacing ────────────────────────────────────────────────
TOOLBAR_H   = 0.35 * inch    # top margin to clear Supernote toolbar
PAGE_MARGIN = 0.3 * inch     # margin on all sides
RULE_SPACING = 9 * mm        # ruled line spacing (9mm is standard notebook)

# ── Week Start ────────────────────────────────────────────────────
# 0 = Monday, 6 = Sunday
FIRST_WEEKDAY = 0

# ── Task Checkboxes (Day Page) ────────────────────────────────────
TASK_ROWS       = 3           # rows of checkboxes
TASK_COLS       = 2           # columns of checkboxes
CHECKBOX_SIZE   = 9           # size in points
CHECKBOX_OFFSET = 5           # left offset from page margin (points)

# ── Year View Font Sizes ─────────────────────────────────────────
YV_MONTH_NAME = 11            # month name in mini-calendar
YV_DAY_HEADER = 8             # M T W T F S S headers
YV_DAY_NUMBER = 9             # day numbers

# ── Navigation ────────────────────────────────────────────────────
NAV_ICON_SIZE   = 12          # icon size in points
NAV_TAP_SIZE    = 20          # tap target size (larger than icon)
NAV_TITLE_SIZE  = 13          # title font size in nav bar

# ── Colors ────────────────────────────────────────────────────────
# Keep minimal for best e-ink rendering and small PNG file size
CLR_BLACK      = black
CLR_WHITE      = white
CLR_GRAY_LIGHT = Color(0.85, 0.85, 0.85)   # borders, grid lines
CLR_GRAY_MED   = Color(0.6, 0.6, 0.6)      # nav icons, subtle text
CLR_GRAY_DARK  = Color(0.3, 0.3, 0.3)      # headers, task divider
CLR_GRAY_RULE  = Color(0.88, 0.88, 0.88)   # ruled lines
CLR_HEADER_BG  = Color(0.94, 0.94, 0.94)   # day header background

# ── Holidays ──────────────────────────────────────────────────────
# Format: datetime.date(YEAR, MONTH, DAY): "Holiday Name"
# These appear on month views, week views, and day pages.
# Add, remove, or modify as needed.
HOLIDAYS = {
    datetime.date(YEAR, 1, 1):   "New Year's Day",
    datetime.date(YEAR, 1, 19):  "MLK Day",
    datetime.date(YEAR, 2, 16):  "Presidents' Day",
    datetime.date(YEAR, 5, 25):  "Memorial Day",
    datetime.date(YEAR, 6, 19):  "Juneteenth",
    datetime.date(YEAR, 7, 4):   "Independence Day",
    datetime.date(YEAR, 9, 7):   "Labor Day",
    datetime.date(YEAR, 10, 12): "Columbus Day",
    datetime.date(YEAR, 11, 11): "Veterans Day",
    datetime.date(YEAR, 11, 26): "Thanksgiving",
    datetime.date(YEAR, 12, 25): "Christmas Day",
}


# ┌──────────────────────────────────────────────────────────────────┐
# │                    END OF CONFIGURATION                          │
# └──────────────────────────────────────────────────────────────────┘


# ── Constants (derived, do not edit) ──────────────────────────────

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]
DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_FULL = [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday"
]

cal = calendar.Calendar(firstweekday=FIRST_WEEKDAY)


# ── Helper Functions ──────────────────────────────────────────────

def ordinal(n):
    """Convert integer to ordinal string: 1 → '1st', 2 → '2nd', etc."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def format_day_title(date):
    """Format date as 'Wednesday, April 15th 2026'."""
    return (f"{DAY_FULL[date.weekday()]}, "
            f"{MONTH_NAMES[date.month]} {ordinal(date.day)} {date.year}")


def get_weeks_of_year():
    """
    Get all Monday–Sunday weeks that contain at least one day in YEAR.
    Returns list of (week_number, start_date, end_date).
    """
    weeks = []
    # Find first Monday on or before Jan 1
    d = datetime.date(YEAR, 1, 1)
    while d.weekday() != 0:
        d -= datetime.timedelta(days=1)

    while True:
        week_start = d
        week_end = d + datetime.timedelta(days=6)
        if week_start.year > YEAR:
            break
        if (week_end >= datetime.date(YEAR, 1, 1) and
                week_start <= datetime.date(YEAR, 12, 31)):
            weeks.append((len(weeks) + 1, week_start, week_end))
        d += datetime.timedelta(days=7)
        if d > datetime.date(YEAR + 1, 1, 10):
            break
    return weeks


def get_all_dates():
    """Return list of all dates in YEAR."""
    dates = []
    d = datetime.date(YEAR, 1, 1)
    while d.year == YEAR:
        dates.append(d)
        d += datetime.timedelta(days=1)
    return dates


# ══════════════════════════════════════════════════════════════════
#  CalendarPDF — Main builder class
# ══════════════════════════════════════════════════════════════════

class CalendarPDF:
    """Builds the complete calendar PDF with all views and navigation."""

    def __init__(self):
        self.c = canvas.Canvas(OUTPUT_FILE, pagesize=(PAGE_W, PAGE_H))
        self.c.setTitle(f"{YEAR} Calendar")
        self.c.setAuthor("Supernote Manta Calendar Generator")

        # Pre-compute data
        self.weeks = get_weeks_of_year()
        self.all_dates = get_all_dates()

        # Bookmark names for internal linking
        # "day_2026-04-15" etc.
        self.date_bookmarks = {
            d: f"day_{d.isoformat()}" for d in self.all_dates
        }

    # ──────────────────────────────────────────────────────────────
    #  Drawing Primitives
    # ──────────────────────────────────────────────────────────────

    def _bookmark(self, name):
        """Create a named destination on the current page."""
        self.c.bookmarkPage(name)

    def _link(self, x, y, w, h, dest):
        """Create a clickable rectangle linking to a named destination."""
        self.c.linkRect("", dest, (x, y, x + w, y + h), relative=0)

    def _text_c(self, x, y, text, font="Helvetica", size=10, color=CLR_BLACK):
        """Draw text centered at (x, y)."""
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        tw = self.c.stringWidth(text, font, size)
        self.c.drawString(x - tw / 2, y, text)

    def _text_l(self, x, y, text, font="Helvetica", size=10, color=CLR_BLACK):
        """Draw text left-aligned at (x, y)."""
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawString(x, y, text)

    def _text_r(self, x, y, text, font="Helvetica", size=10, color=CLR_BLACK):
        """Draw text right-aligned at (x, y)."""
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        tw = self.c.stringWidth(text, font, size)
        self.c.drawString(x - tw, y, text)

    def _rect(self, x, y, w, h, stroke_color=CLR_GRAY_LIGHT,
              fill_color=None, width=0.5):
        """Draw a rectangle, optionally filled."""
        self.c.setStrokeColor(stroke_color)
        self.c.setLineWidth(width)
        if fill_color:
            self.c.setFillColor(fill_color)
            self.c.rect(x, y, w, h, stroke=1, fill=1)
        else:
            self.c.rect(x, y, w, h, stroke=1, fill=0)

    def _line(self, x1, y1, x2, y2, color=CLR_GRAY_LIGHT, width=0.5):
        """Draw a line."""
        self.c.setStrokeColor(color)
        self.c.setLineWidth(width)
        self.c.line(x1, y1, x2, y2)

    def _checkbox(self, x, y):
        """Draw an empty checkbox square at (x, y)."""
        self.c.setStrokeColor(CLR_GRAY_MED)
        self.c.setLineWidth(0.6)
        self.c.rect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE, stroke=1, fill=0)

    # ──────────────────────────────────────────────────────────────
    #  Navigation Icons (line-based, no images)
    # ──────────────────────────────────────────────────────────────

    def _icon_year(self, cx, cy, s):
        """Grid icon (3×4) representing year view."""
        self.c.setStrokeColor(CLR_GRAY_MED)
        self.c.setLineWidth(0.6)
        h = s / 2
        self.c.rect(cx - h, cy - h, s, s, stroke=1, fill=0)
        for i in range(1, 3):
            x = cx - h + i * s / 3
            self.c.line(x, cy - h, x, cy + h)
        for i in range(1, 4):
            y = cy - h + i * s / 4
            self.c.line(cx - h, y, cx + h, y)

    def _icon_month(self, cx, cy, s):
        """Calendar page icon with header bar and dots."""
        self.c.setStrokeColor(CLR_GRAY_MED)
        self.c.setLineWidth(0.6)
        h = s / 2
        self.c.rect(cx - h, cy - h, s, s, stroke=1, fill=0)
        header_y = cy + h - s * 0.25
        self.c.line(cx - h, header_y, cx + h, header_y)
        for r in range(2):
            for c in range(3):
                dx = cx - h + (c + 0.5) * s / 3
                dy = header_y - (r + 1) * s * 0.22
                self.c.setFillColor(CLR_GRAY_MED)
                self.c.circle(dx, dy, 0.8, stroke=0, fill=1)

    def _icon_week(self, cx, cy, s):
        """Horizontal lines icon representing week/list view."""
        self.c.setStrokeColor(CLR_GRAY_MED)
        self.c.setLineWidth(0.7)
        h = s / 2
        for i in range(4):
            y = cy - h + (i + 0.5) * s / 4
            self.c.line(cx - h, y, cx + h, y)

    def _icon_prev(self, cx, cy, s):
        """Left chevron < arrow."""
        self.c.setStrokeColor(CLR_GRAY_MED)
        self.c.setLineWidth(0.8)
        h = s / 2
        self.c.line(cx + h * 0.3, cy + h * 0.6, cx - h * 0.3, cy)
        self.c.line(cx - h * 0.3, cy, cx + h * 0.3, cy - h * 0.6)

    def _icon_next(self, cx, cy, s):
        """Right chevron > arrow."""
        self.c.setStrokeColor(CLR_GRAY_MED)
        self.c.setLineWidth(0.8)
        h = s / 2
        self.c.line(cx - h * 0.3, cy + h * 0.6, cx + h * 0.3, cy)
        self.c.line(cx + h * 0.3, cy, cx - h * 0.3, cy - h * 0.6)

    def _draw_icon(self, icon_type, cx, cy, s):
        """Dispatch to the correct icon drawing method."""
        {"year": self._icon_year, "month": self._icon_month,
         "week": self._icon_week, "prev": self._icon_prev,
         "next": self._icon_next}[icon_type](cx, cy, s)

    # ──────────────────────────────────────────────────────────────
    #  Navigation Bar
    #  Drawn at the top of every page, below the toolbar zone.
    #  Layout: [icon] [icon] ... TITLE ... [icon] [icon]
    # ──────────────────────────────────────────────────────────────

    def _nav_bar(self, title, left=None, right=None):
        """
        Draw the navigation bar and return the Y position where
        page content should begin (below the separator line).

        Args:
            title: centered title string
            left:  list of (icon_type, bookmark_name) for left side
            right: list of (icon_type, bookmark_name) for right side
        """
        nav_y = PAGE_H - TOOLBAR_H - 16
        icon_cy = nav_y + 6
        s = NAV_ICON_SIZE
        tap = NAV_TAP_SIZE

        # Title
        self._text_c(PAGE_W / 2, nav_y, title,
                     font="Helvetica-Bold", size=NAV_TITLE_SIZE)

        # Left icons
        if left:
            lx = PAGE_MARGIN + s / 2 + 2
            for icon_type, bookmark in left:
                self._draw_icon(icon_type, lx, icon_cy, s)
                self._link(lx - tap / 2, icon_cy - tap / 2, tap, tap, bookmark)
                lx += s + 14

        # Right icons (drawn right-to-left)
        if right:
            rx = PAGE_W - PAGE_MARGIN - s / 2 - 2
            for icon_type, bookmark in reversed(right):
                self._draw_icon(icon_type, rx, icon_cy, s)
                self._link(rx - tap / 2, icon_cy - tap / 2, tap, tap, bookmark)
                rx -= s + 14

        # Separator line
        sep_y = nav_y - 8
        self._line(PAGE_MARGIN, sep_y, PAGE_W - PAGE_MARGIN, sep_y,
                   CLR_GRAY_LIGHT, 0.75)

        return sep_y - 6  # content starts here

    # ══════════════════════════════════════════════════════════════
    #  PAGE 1: YEAR VIEW
    #  12 mini-calendars in a 3×4 grid.
    #  - Tap month name → month page
    #  - Tap any day number → that day's note/task page
    # ══════════════════════════════════════════════════════════════

    def draw_year_view(self):
        self._bookmark("year")
        content_top = self._nav_bar(str(YEAR))

        cols, rows = 3, 4
        grid_w = PAGE_W - 2 * PAGE_MARGIN
        grid_h = content_top - PAGE_MARGIN
        cell_w = grid_w / cols
        cell_h = grid_h / rows

        # Draw each month's mini-calendar
        for month in range(1, 13):
            col = (month - 1) % cols
            row = (month - 1) // cols
            cx = PAGE_MARGIN + col * cell_w
            cy = content_top - row * cell_h
            self._mini_calendar(cx, cy, cell_w, cell_h, month)

        # Separator lines between month cells
        for col in range(1, cols):
            sx = PAGE_MARGIN + col * cell_w
            self._line(sx, content_top, sx, content_top - rows * cell_h,
                       CLR_GRAY_LIGHT, 0.5)
        for row in range(1, rows):
            sy = content_top - row * cell_h
            self._line(PAGE_MARGIN, sy, PAGE_MARGIN + grid_w, sy,
                       CLR_GRAY_LIGHT, 0.5)

        self.c.showPage()

    def _mini_calendar(self, x, y, w, h, month):
        """Draw one mini-calendar within the year view."""
        pad = 4
        inner_x = x + pad
        inner_w = w - 2 * pad

        # Month name with gray background (tappable → month page)
        title_h = 16
        title_y = y - pad - title_h
        self.c.setFillColor(CLR_HEADER_BG)
        self.c.rect(inner_x, title_y - 1, inner_w, title_h + 2,
                    stroke=0, fill=1)
        self._text_c(inner_x + inner_w / 2, title_y + 4,
                     MONTH_NAMES[month],
                     font="Helvetica-Bold", size=YV_MONTH_NAME)
        self._link(inner_x, title_y - 2, inner_w, title_h + 4,
                   f"month_{month}")

        # Day-of-week header row (M T W T F S S)
        header_y = title_y - 14
        day_w = inner_w / 7
        for i, d in enumerate(DAY_ABBR):
            dx = inner_x + i * day_w
            self._text_c(dx + day_w / 2, header_y + 2, d[0],
                         font="Helvetica", size=YV_DAY_HEADER,
                         color=CLR_GRAY_MED)

        # Day number grid
        weeks = cal.monthdayscalendar(YEAR, month)
        remaining_h = h - pad - title_h - 16
        row_h = remaining_h / max(len(weeks), 1)

        for wi, week in enumerate(weeks):
            ry = header_y - (wi + 1) * row_h
            for di, day in enumerate(week):
                if day == 0:
                    continue
                dx = inner_x + di * day_w
                date = datetime.date(YEAR, month, day)
                is_holiday = date in HOLIDAYS
                font = "Helvetica-Bold" if is_holiday else "Helvetica"
                self._text_c(dx + day_w / 2, ry + row_h * 0.25,
                             str(day), font=font, size=YV_DAY_NUMBER)
                # Tap day → day note/task page
                self._link(dx, ry, day_w, row_h,
                           self.date_bookmarks[date])

    # ══════════════════════════════════════════════════════════════
    #  PAGES 2–13: MONTH VIEWS
    #  Full month grid with day numbers and holiday labels.
    #  - Tap any day → that day's note/task page
    #  - Nav: year icon, prev/next month arrows
    # ══════════════════════════════════════════════════════════════

    def draw_month_view(self, month):
        self._bookmark(f"month_{month}")

        # Navigation
        left = [("year", "year")]
        right = []
        if month > 1:
            right.append(("prev", f"month_{month - 1}"))
        if month < 12:
            right.append(("next", f"month_{month + 1}"))

        content_top = self._nav_bar(f"{MONTH_NAMES[month]} {YEAR}",
                                     left=left, right=right)

        # Day-of-week headers
        grid_left = PAGE_MARGIN
        grid_w = PAGE_W - 2 * PAGE_MARGIN
        day_w = grid_w / 7
        header_y = content_top - 4

        for i, d in enumerate(DAY_ABBR):
            dx = grid_left + i * day_w
            self._text_c(dx + day_w / 2, header_y, d,
                         font="Helvetica-Bold", size=9, color=CLR_GRAY_DARK)

        self._line(grid_left, header_y - 4, grid_left + grid_w,
                   header_y - 4, CLR_GRAY_LIGHT, 0.75)

        # Day grid
        weeks_data = cal.monthdayscalendar(YEAR, month)
        grid_top = header_y - 8
        available_h = grid_top - PAGE_MARGIN
        row_h = available_h / max(len(weeks_data), 1)

        for wi, week in enumerate(weeks_data):
            ry = grid_top - wi * row_h
            cell_y = ry - row_h

            # Horizontal separator between weeks
            if wi > 0:
                self._line(grid_left, ry, grid_left + grid_w, ry,
                           CLR_GRAY_LIGHT, 0.5)

            for di, day in enumerate(week):
                dx = grid_left + di * day_w

                # Vertical separators
                if di > 0:
                    self._line(dx, grid_top,
                               dx, grid_top - len(weeks_data) * row_h,
                               CLR_GRAY_LIGHT, 0.3)
                if day == 0:
                    continue

                date = datetime.date(YEAR, month, day)
                is_holiday = date in HOLIDAYS

                # Day number
                self._text_l(
                    dx + 3, ry - 12, str(day),
                    font="Helvetica-Bold" if is_holiday else "Helvetica",
                    size=10)

                # Holiday name (truncated if long)
                if is_holiday:
                    hname = HOLIDAYS[date]
                    if len(hname) > 10:
                        hname = hname[:9] + "…"
                    self._text_l(dx + 3, ry - 22, hname,
                                 font="Helvetica", size=5.5,
                                 color=CLR_GRAY_MED)

                # Tap day → day page
                self._link(dx, cell_y, day_w, row_h,
                           self.date_bookmarks[date])

        # Outer border
        self._rect(grid_left,
                   grid_top - len(weeks_data) * row_h,
                   grid_w, len(weeks_data) * row_h,
                   stroke_color=CLR_GRAY_LIGHT, width=0.75)

        self.c.showPage()

    # ══════════════════════════════════════════════════════════════
    #  PAGES 14–66: WEEK VIEWS
    #  Clean 7-day overview with ruled lines for quick notes.
    #  - Tap day header bar → that day's note/task page
    #  - Nav: year, month, prev/next week
    # ══════════════════════════════════════════════════════════════

    def draw_week_view(self, week_idx):
        wnum, wstart, wend = self.weeks[week_idx]
        self._bookmark(f"week_{week_idx}")

        # Navigation
        ref_month = wstart.month if wstart.year == YEAR else wend.month
        left = [("year", "year"),
                ("month", f"month_{ref_month}")]
        right = []
        if week_idx > 0:
            right.append(("prev", f"week_{week_idx - 1}"))
        if week_idx < len(self.weeks) - 1:
            right.append(("next", f"week_{week_idx + 1}"))

        title = f"{wstart.strftime('%b %d')} – {wend.strftime('%b %d, %Y')}"
        content_top = self._nav_bar(title, left=left, right=right)

        # 7 day rows
        grid_left = PAGE_MARGIN
        grid_w = PAGE_W - 2 * PAGE_MARGIN
        available_h = content_top - PAGE_MARGIN
        row_h = available_h / 7

        for i in range(7):
            date = wstart + datetime.timedelta(days=i)
            ry = content_top - i * row_h
            is_holiday = date in HOLIDAYS
            is_in_year = date.year == YEAR

            # Gray header bar with day name
            header_h = 14
            header_y = ry - header_h

            self.c.setFillColor(CLR_HEADER_BG)
            self.c.rect(grid_left, header_y, grid_w, header_h,
                        stroke=0, fill=1)

            day_label = f"{DAY_ABBR[i]}  {date.strftime('%B %d')}"
            if not is_in_year:
                day_label += f" ({date.year})"
            self._text_l(grid_left + 5, header_y + 3, day_label,
                         font="Helvetica-Bold", size=8,
                         color=CLR_BLACK if is_in_year else CLR_GRAY_MED)

            # Holiday name on the right
            if is_holiday:
                self._text_r(grid_left + grid_w - 5, header_y + 3,
                             HOLIDAYS[date],
                             font="Helvetica", size=6.5,
                             color=CLR_GRAY_MED)

            # Tap header → day page
            if is_in_year:
                self._link(grid_left, header_y, grid_w, header_h,
                           self.date_bookmarks[date])

            # Faint ruled lines for writing
            content_bottom = ry - row_h
            rule_y = header_y - RULE_SPACING
            while rule_y > content_bottom + 4:
                self._line(grid_left + 3, rule_y,
                           grid_left + grid_w - 3, rule_y,
                           CLR_GRAY_RULE, 0.3)
                rule_y -= RULE_SPACING

            # Day section border
            self._rect(grid_left, content_bottom, grid_w, row_h,
                       stroke_color=CLR_GRAY_LIGHT, width=0.5)

        self.c.showPage()

    # ══════════════════════════════════════════════════════════════
    #  PAGES 67–431: DAY NOTE/TASK PAGES
    #
    #  Layout:
    #    "Tasks" label
    #    ─────────────  ← ruled line 1
    #    ☐         ☐   ← checkboxes centered between lines 1–2
    #    ─────────────  ← ruled line 2
    #    ☐         ☐   ← checkboxes centered between lines 2–3
    #    ─────────────  ← ruled line 3
    #    ☐         ☐   ← checkboxes centered between lines 3–4
    #    ═════════════  ← thicker divider line (line 4)
    #    ─────────────  ← notes continue with 9mm ruled lines
    #    ─────────────
    #    ...
    #
    #  Nav: year, month, week, prev/next day
    # ══════════════════════════════════════════════════════════════

    def draw_day_page(self, date):
        self._bookmark(self.date_bookmarks[date])

        # Find which week this date belongs to (for week nav icon)
        target_week_idx = None
        for idx, (wnum, wstart, wend) in enumerate(self.weeks):
            if wstart <= date <= wend:
                target_week_idx = idx
                break

        # Navigation
        left = [("year", "year"),
                ("month", f"month_{date.month}")]
        if target_week_idx is not None:
            left.append(("week", f"week_{target_week_idx}"))

        right = []
        prev_date = date - datetime.timedelta(days=1)
        next_date = date + datetime.timedelta(days=1)
        if prev_date.year == YEAR:
            right.append(("prev", self.date_bookmarks[prev_date]))
        if next_date.year == YEAR:
            right.append(("next", self.date_bookmarks[next_date]))

        content_top = self._nav_bar(format_day_title(date),
                                     left=left, right=right)

        # Holiday subtitle (if applicable)
        if date in HOLIDAYS:
            self._text_c(PAGE_W / 2, content_top - 4, HOLIDAYS[date],
                         font="Helvetica", size=10, color=CLR_GRAY_MED)
            task_top = content_top - 20
        else:
            task_top = content_top - 4

        # "Tasks" label, left-aligned with checkbox edge
        grid_left = PAGE_MARGIN
        grid_w = PAGE_W - 2 * PAGE_MARGIN
        self._text_l(grid_left + CHECKBOX_OFFSET, task_top - 11, "Tasks",
                     font="Helvetica", size=9, color=CLR_GRAY_MED)

        # Ruled lines + checkboxes
        # Lines are continuous at 9mm spacing from top to bottom.
        # The first TASK_ROWS gaps contain checkboxes.
        # Line number TASK_ROWS is drawn thicker as the divider.
        first_line_y = task_top - 16
        col_w = grid_w / TASK_COLS
        divider_index = TASK_ROWS

        line_y = first_line_y
        line_idx = 0
        while line_y > PAGE_MARGIN + 5:
            # Draw ruled line (thicker for divider)
            if line_idx == divider_index:
                self._line(grid_left, line_y, grid_left + grid_w, line_y,
                           CLR_GRAY_DARK, 0.75)
            else:
                self._line(grid_left, line_y, grid_left + grid_w, line_y,
                           CLR_GRAY_RULE, 0.4)

            # Checkboxes centered between this line and the next
            if line_idx < TASK_ROWS:
                cb_y = line_y - RULE_SPACING / 2 - CHECKBOX_SIZE / 2
                for ccol in range(TASK_COLS):
                    cb_x = grid_left + CHECKBOX_OFFSET + ccol * col_w
                    self._checkbox(cb_x, cb_y)

            line_y -= RULE_SPACING
            line_idx += 1

        self.c.showPage()

    # ══════════════════════════════════════════════════════════════
    #  Build — generates the complete PDF
    # ══════════════════════════════════════════════════════════════

    def build(self):
        total = 1 + 12 + len(self.weeks) + len(self.all_dates)
        print(f"Building {YEAR} Supernote Calendar...")
        print(f"  Output:     {OUTPUT_FILE}")
        print(f"  Page size:  {PAGE_W / inch:.1f}\" × {PAGE_H / inch:.1f}\"")
        print(f"  Ruled lines:{RULE_SPACING / mm:.0f}mm spacing")
        print(f"  Holidays:   {len(HOLIDAYS)}")
        print(f"  Pages:      {total} "
              f"(1 year + 12 months + {len(self.weeks)} weeks "
              f"+ {len(self.all_dates)} days)")
        print()

        # Year view (page 1)
        print("  [1/4] Year view...")
        self.draw_year_view()

        # Month views (pages 2–13)
        print("  [2/4] Month views...")
        for month in range(1, 13):
            self.draw_month_view(month)

        # Week views (pages 14–66)
        print("  [3/4] Week views...")
        for week_idx in range(len(self.weeks)):
            self.draw_week_view(week_idx)

        # Day pages (pages 67–431)
        print("  [4/4] Day pages...")
        for date in self.all_dates:
            self.draw_day_page(date)

        self.c.save()

        size = os.path.getsize(OUTPUT_FILE)
        print(f"\n  ✓ Saved: {OUTPUT_FILE}")
        print(f"  ✓ Size:  {size / 1024:.0f} KB ({size / (1024*1024):.1f} MB)")
        print(f"  ✓ Pages: {total}")


# ══════════════════════════════════════════════════════════════════
#  Entry point
# ══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    CalendarPDF().build()
