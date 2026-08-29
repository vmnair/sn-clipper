# 📎 Clipper

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="version" />
  <img src="https://img.shields.io/badge/platform-Supernote%20(Manta)-000000" alt="platform" />
  <img src="https://img.shields.io/badge/built%20with-React%20Native-61DAFB?logo=react&logoColor=white" alt="react native" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
</p>

> **Collect text & image clips from your reading, and drop them straight into your notes.**

Clipper is a utility plugin for Supernote devices that lets you select and aggregate
text **and image regions** from e-books (EPUB), documents (PDF, TXT, CBZ, FB2), and notes,
collects them into a unified dashboard, and inserts them back into your note pages.

I built it to solve a workflow problem: adding a series of selected passages to the Supernote
`digest` app while reading. That used to mean constantly switching between the article and the
digest app, which broke focus. Clipper lets you **capture as you read** and **paste the
aggregated result in one step**.

> ⚠️ **Beta: use at your own risk. No warranty.** Tested on Manta (A5X2), Chauvet 3.29.43_beta; not yet tested on Nomad.

> 📌 **Firmware requirement:** Clipper v0.2.0 and later require the Supernote plugin beta firmware (Chauvet 3.29.43_beta or newer). That firmware also refuses to run older Clipper builds, so if you update your Supernote, update Clipper too.

---

## ✨ Features

Four parts: **capture** clips while reading → **manage** them in a dashboard → **insert** them
into a note → **settings** to tune insertion.

### ✂️ Capturing clips

- 🖍️ **Highlight → Clip (text).** Select text in a document and tap **Clip** on the selection
  toolbar. Each clip is labelled with its source file. A longer selection is saved **silently
  as text**: no dialog, so you stay in the flow of reading.
- 🔀 **Text vs Region prompt.** A short selection opens a prompt to pick **Clip Text** or
  **Clip Region** (a short highlight is the natural way to "mark this spot" for a figure).
- 🖼️ **Clip Region (image).** Choose **Clip Region**, drag to frame a rectangle, and save it as
  an image clip. It captures the **live, on-screen reader page**, so it reproduces exactly what
  you see, including **reflowable EPUB** at your chosen font, not just fixed-layout PDF.
- 📚 **Works across formats.** Text and region clipping from **PDF, EPUB, TXT, CBZ, FB2**, and notes.

### 🗂️ The Clipper dashboard

- 📋 **Unified clip list.** Opened from the plugins sidebar ("Clipper"); text clips show a
  snippet, region clips show a thumbnail, each labelled with its source document.
- 🔢 **Dynamic badge count.** The sidebar button shows the current count, e.g. `Clipper (5)`.
- 🔍 **Search.** Filter by keyword (matches clip text and source name).
- 🏷️ **Filter by source.** Show only clips from a chosen document.
- ↗️ **Jump-to-Source.** Tap the **Jump** icon next to any clip card in the dashboard to reopen its source document (PDF, EPUB, or Note) at the exact page you clipped from.
- ↕️ **Sort.** Newest-first or oldest-first.

### 🧰 Organizing clips (selection mode)

- ✅ **Select.** Long-press a clip to enter selection mode, then tap to select more.
- 🔗 **Merge (text).** Combine two or more **text** clips into one, with their sources noted.
- ✂️ **Unmerge.** Break a merged clip back into its individual pieces.
- 📄 **Copy.** Copy the visible or selected clips (combined text) to the system clipboard.
  *(Disabled for a figure, since an image can't go on the text clipboard.)*
- 🗑️ **Delete / Clear All.** Remove selected clips, or clear everything.
- 🖼️ **Figures and text can be mixed.** Scaled insertion of figures in notes.

### 📝 Inserting into a note

- 🧱 **Combined text block.** Text clips are inserted as **one text box**, separated by a single
  blank line, for uniform, tidy spacing (togglable; off = a separate box per clip).
- ↗️ **In-Note Back-Links.** Automatically appends a tappable back-link to the source page under inserted clips:
  - *Separate mode*: Pins a small `↗` inline icon to the right margin of the last text line (retaining uniform line spacing).
  - *Combined mode*: Appends labeled links `[filename, p. N ↗]` stacked at the bottom of the text block to clearly distinguish multiple sources.
- ✂️ **Long-clip auto-split.** A clip too tall for one page is split at a **sentence boundary**;
  the rest continues on the next page.
- 🖼️ **Multiple figures (region clips) can be inserted into a page.** The previous limitation of one page, one image has been lifted.
- 📄 **Current-page insertion.** Clipper inserts onto the page you're viewing; when more remains,
  it inserts what fits and prompts you to **turn to a new page and Insert again**.

### ⚙️ Settings (gear icon)

- 🧹 **Remove clips after inserting** *(default: on)*: delete clips once inserted, or keep them
  (e.g. to insert the same set into several notes).
- 🧱 **Combine inserted text** *(default: off)*: one block, or a separate box per clip.
- 🏷️ **Show source & jump in Clipper** *(default: on)*: shows/hides the source file label and the jump icon on cards.
- 🔗 **Link source when inserting** *(default: on)*: toggles appending of back-links into notes.
- 🔠 **Inserted text size**: **Small / Medium / Large**.
- 📄 **Table of contents**: add a table of contents anywhere in the note, based on handwritten or text headings.
- 🔄 **Reset to default**: quickly restore all default settings.

---

## 📦 Installation & Sideloading

1. ⬇️ Download the latest `SnClipper.snplg` from the [Releases](https://github.com/vmnair/sn-clipper/releases) page.
2. 🔌 Connect your Supernote to your computer via USB.
3. 📁 Copy `SnClipper.snplg` into `/Supernote/MyStyle`.
4. ⚙️ On the device, open **Settings → My Style → Sideloading** and install/update the plugin.
5. ✅ The plugin appears as **Clipper**.
6. 🔐 On first use, Clipper will ask for file access (see Permissions below).

---

## 🔐 Permissions

The Supernote plugin firmware (Chauvet 3.29.43_beta and later) includes a permission system:
plugins must ask before reading or modifying your files. Clipper declares two permissions and
asks for each one only when a feature needs it.

| Permission | Used for |
|---|---|
| **Read Files** | Capturing clips, Jump-to-Source, and region capture |
| **Modify Files** | Inserting image clips into a note, and refreshing an existing Table of Contents |

A few things worth knowing:

- **Text-only inserts do not need "Modify Files".** If you only clip and insert text, granting
  Read Files is enough.
- You can manage both permissions any time under **Settings → Apps → Plugins → Clipper →
  Permissions** (Allow / Ask Every Time / Don't Allow). If you change a setting while Clipper
  is open, close and reopen Clipper for it to take effect.
- **Your data stays on your device.** Clipper requests no internet permission, makes no network
  calls, and stores clips, images, and settings in its own private storage, which is unaffected
  by these permission choices.

---

## 🚀 Getting Started

1. **Clip while reading.** In a PDF/EPUB/text document, select text and tap **Clip**. For a
   figure, make a short selection, choose **Clip Region**, and frame the area.
2. **Review in the dashboard.** Open the plugins menu → **Clipper** to see, search, filter,
   merge, or delete your clips.
3. **Insert into a note.** Open a note, then in Clipper tap **Insert into open Note**. Text
   flows into one block; Text and figures can be mixed, multiple figures can be added to a page.
   Turn to a new page and Insert again if prompted.

---

## ⚠️ Notes & Limitations

- 🖼️ **Region capture** works by capturing the live reader view via the plugin host's system
  privileges, because the SDK cannot re-render reflowable EPUB at the reader's font and
  pagination. This still works on the current permission firmware. When Supernote ships an
  official screen-capture API, I plan to switch to it so no system calls are made.
- 📐 **Figure placement is automatic:** multiple figures insert in one pass and are laid out down the page, but you can't hand-pick a spot for each during insert. Reposition them afterwards with the lasso if needed.
- 📄 **Inserting works on the current page only**: the plugin can't turn pages for you. When a
  clip is split or a figure needs its own page, Clipper inserts what fits, then asks you to turn
  to a new page and Insert again.

---

## 🗺️ Roadmap

- ✍️ Highlight selections in the document (clipped text isn't highlighted in place yet).
- 📱 Testing on **Nomad**: I do not own a Nomad, so feedback from Nomad users is very welcome.
- 🔐 Surface permission error codes in the write paths (today a revoked permission mid-flow
  fails quietly in ToC refresh and image inserts; the up-front prompts prevent this in practice).
- ↗️ Move Jump-to-Source to the SDK's `openFile` API instead of the current native intent.
- 🖼️ Investigate copying image clips to the system clipboard. Copy currently uses the text-only
  clipboard API, so image clips can't be copied. Needs a native ClipData/FileProvider module,
  and first a proof that any Supernote app can paste an image from the clipboard at all.
  Alternative worth exploring: exposing image clips through the sticker workflow instead
  (the plugin SDK has sticker APIs), since stickers are the native way pictures enter notes.

---

## 📄 License

Licensed under the **MIT License**: see the [LICENSE](LICENSE) file for details.
