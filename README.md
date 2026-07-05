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
- **Select, merge & delete**: Long-press to enter selection mode; merge multiple clippings
  into one, or delete them.
- **Insert into a note**: Paste the aggregated clips into your open note. Text stacks in
  place; images are inserted one figure per page (add a page to insert the next figure).
- **Settings**: A gear icon opens settings. "Remove clips after inserting" (on by default)
  controls whether inserted clips are removed from Clipper or kept.

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
- **Copy**: Copy the visible or selected clips (combined) to the system clipboard.
- **Insert into open Note**: Paste the clips into your active note (only when editing a note).
- **Merge**: In selection mode, merge two or more clips into one.
- **Search / Filter**: Search by keyword or filter by source document.
- **Delete / Clear All**: Delete selected clips or clear everything.
- **Settings**: Tap the gear icon to toggle whether clips are removed after being inserted.

---

## Notes & Limitations

- **Region capture** relies on capturing the live reader view via the plugin host's system
  privileges. This is required because the SDK cannot re-render reflowable EPUB at the
  reader's font/pagination. It could be affected by a future firmware change.
- **Images can't be positioned individually** by the plugin, so inserted figures are placed
  one per page. Add a new page in your note to insert the next figure.

---

## Todo

- Highlight selections in the document (currently the clipped text is not highlighted in place).
- I have not tested this on a Nomad as I do not own one. If anyone can test on a Supernote
  Nomad and provide feedback, I would appreciate it.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
