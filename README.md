# Clipper

Clipper is a utility plugin for Supernote devices that lets you select and aggregate
text **and image regions** from e-books (EPUB), documents (PDF, TXT, CBZ, FB2), and notes,
collects them into a unified dashboard, and inserts them back into your note pages.

I developed this plugin to solve a workflow problem: adding a series of selected passages
to the Supernote `digest` app while reading. Previously this required frequently switching
between the article being read and the digest app, which broke focus. Clipper lets you
capture as you read and paste the aggregated result in one step.

I made heavy use of agentic coding tools during development.

Use this plugin at your own risk. I do not make any warranty.

---

## Key Features

- **Highlight to clip**: Select text in a document and tap **Clip** in the selection
  toolbar. Longer selections are saved silently as text; a short selection opens a prompt
  so you can choose **Clip Text** or **Clip Region**.
- **Region (image) capture**: From the selection prompt, choose **Clip Region** to frame a
  rectangular area of the page and save it as an image clip. This captures the live reader
  page, so it works correctly for reflowable EPUB as well as fixed-layout PDF.
- **Clipper dashboard**: Opened from the Supernote plugins sidebar ("Clipper"); lists all
  your clippings with their source document.
- **Dynamic badge count**: The sidebar button shows the current clip count (e.g. `Clipper (5)`).
- **Search & filter**: Search clippings or filter by source document.
- **Select, merge, unmerge & delete**: Long-press to enter selection mode. Merge multiple
  **text** clips into one, **Unmerge** a merged clip back into its pieces, or delete. (A
  figure can only be selected on its own; text and figures aren't merged together.)
- **Insert into a note**: Insert your clips into the open note. Text clips are combined into
  a single block (uniform spacing); a clip too long for one page is split at a sentence
  boundary and continued on the next page; each figure is placed alone on its own page.
  Clipper inserts onto the page you're currently viewing — when more remains, turn to a new
  page and Insert again.
- **Settings**: A gear icon opens settings:
  - **Remove clips after inserting** (on) — delete clips from Clipper once inserted, or keep them.
  - **Combine inserted text** (on) — insert text clips as one block, or as separate boxes
    (separate boxes are easier to select/move individually in the note).
  - **Inserted text size** — Small / Medium / Large font for inserted text.

---

## Installation & Sideloading

To load the pre-compiled plugin onto your Supernote device:

1. Download the latest `SnClipper.snplg` from the [Releases](https://github.com/vmnair/Supernote/releases) page.
2. Connect your Supernote to your computer via USB.
3. Copy `SnClipper.snplg` into `/Supernote/MyStyle`.
4. On the device, open **Settings → My Style → Sideloading** and install/update the plugin.
5. The plugin appears as **Clipper**.

---

## How to Use

### 1. Clipping text
Open an EPUB, PDF, or text document, select a passage, and tap **Clip** in the selection
toolbar. A longer selection is clipped silently as text; a short selection prompts you to
choose **Clip Text** or **Clip Region**.

### 2. Clipping a region (image)
On the short-selection prompt, tap **Clip Region**, frame the area you want, and save it.
The region is stored as an image clip.

### 3. Opening the Clipper dashboard
While in a document or note, open the plugins menu and tap **Clipper**.

### 4. Managing clippings
- **Copy**: Copy the visible or selected clips (text, combined) to the system clipboard.
  (Copy is disabled for a figure — an image can't be placed on the text clipboard.)
- **Insert into open Note**: Insert clips into your active note (only when editing a note).
  Text combines into one block; a very long clip continues on the next page; a figure takes
  its own page. Turn to a new page and Insert again to continue when prompted.
- **Merge / Unmerge**: In selection mode, merge two or more **text** clips into one, or
  Unmerge a merged clip back into its individual pieces.
- **Search / Filter**: Search by keyword or filter by source document.
- **Delete / Clear All**: Delete selected clips or clear everything.
- **Settings**: Tap the gear icon for: remove-clips-after-inserting, combine-inserted-text,
  and inserted-text size.

---

## Notes & Limitations

- **Region capture** relies on capturing the live reader view via the plugin host's system
  privileges. This is required because the SDK cannot re-render reflowable EPUB at the
  reader's font/pagination. It could be affected by a future firmware change.
- **Images can't be positioned individually** by the plugin (the SDK centers them), so a
  figure is inserted alone on its own page; text is never placed on a figure's page.
- **Inserting works on the current page only** — the plugin can't turn pages for you. When a
  clip is split across pages or a figure needs its own page, Clipper inserts what fits, then
  asks you to turn to a new page and Insert again to continue.

---

## Todo

- Highlight selections in the document (currently the clipped text is not highlighted in place).
- I have not tested this on a Nomad as I do not own one. If anyone can test on a Supernote
  Nomad and provide feedback, I would appreciate it.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
