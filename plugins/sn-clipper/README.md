# Clipper

Clipper is a utility plugin for Supernote devices that allows you to select,
highlight, and aggregate text snippets from e-books (EPUBs),
documents (PDFs, TXT), and notes, compiles them into a unified dashboard,
and lets you insert the aggregated text back into note pages.

I developed this plugin to address a specific use case to enable adding a series
of selected texts to digest while reading an article or document. Currently, it
would require us to switch frequently from article being read to digest which
results in loss of focus.

I have used agentic coding during this developemt (local LLM, Gemini).

Please feel free to use / modify as you see fit.

Use this plugin at your own risk. I do not make any warrenty.

---

## Key Features

- **Highlight to Clip**: A text-selection toolbar button ("Clip Text") captures
  selected text and labels it with the source file name. Currently, the text clipped
  does not show highlight, I am exploring how to achieve this.
- **Clipper App**: Accessible directly from the Supernote plugins sidebar menu
  ("Clipper"), displaying a list of all your clippings.
- **Dynamic Badge Count**: The sidebar menu button dynamically updates its
  label to show the count of current clips (e.g., `Clipper (5)`).
- **Search & Filters**: Quickly search clippings or filter by specific source
  documents.

---

## Installation & Sideloading

To load the pre-compiled plugin onto your Supernote device:

1.  Download the latest `SnClipper.snplg` file from the [Releases](https://github.com/vmnair/Supernote/releases) page.
2.  Connect your Supernote device to your computer via USB.
3.  Copy the `SnClipper.snplg` file into the `/Supernote/MyStyle`
4.  Install plugin.
5.  Plugin will show as `Clipper` on the device.

---

## How to Use

### 1. Clipping Text

Open any EPUB, PDF, or text document, select/highlight a block of text, and
click the **Clip Text** option in the text toolbar. A notification will appear,
and the text will be added to your clipboard manager.

### 2. Accessing the Clipper App

While inside a document (PDF, ePub) open the plugin menu and access Clipper App.

### 3. Managing Clippings

- **Copy Aggregated**: Copies all clips combined sequentially to your system clipboard.
- **Insert into Note**: Pastes the combined clippings into your active Note
  page (only active when editing a note).
- **Search**: Tap the search bar to filter clips by keywords.
- **Filter by Source**: Click the source chips to filter clippings from a
  specific document.
- **Delete/Clear**: Delete individual clips by clicking the cross icon or
  clear all clippings with the "Clear All" button.

---

## Todo:

[ ] Merge clips
[ ] I have not tested this in a Nomad as I do not own one. If anyone can test on
a Supernote Nomad device & provideme feedback, I would appreciate it.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
