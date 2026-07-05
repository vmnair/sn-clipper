# 📎 Clipper

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version" />
  <img src="https://img.shields.io/badge/platform-Supernote%20(Manta)-000000" alt="platform" />
  <img src="https://img.shields.io/badge/built%20with-React%20Native-61DAFB?logo=react&logoColor=white" alt="react native" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
</p>

> **Collect text & image clips from your reading — and drop them straight into your notes.**

Clipper is a utility plugin for Supernote devices that lets you select and aggregate
text **and image regions** from e‑books (EPUB), documents (PDF, TXT, CBZ, FB2), and notes,
collects them into a unified dashboard, and inserts them back into your note pages.

I built it to solve a workflow problem: adding a series of selected passages to the Supernote
`digest` app while reading. That used to mean constantly switching between the article and the
digest app, which broke focus. Clipper lets you **capture as you read** and **paste the
aggregated result in one step**.

> ⚠️ **Beta — use at your own risk. No warranty.** Tested on Manta (A5X2); not yet tested on Nomad.

---

## ✨ Features

Four parts: **capture** clips while reading → **manage** them in a dashboard → **insert** them
into a note → **settings** to tune insertion.

### ✂️ Capturing clips

- 🖍️ **Highlight → Clip (text).** Select text in a document and tap **Clip** on the selection
  toolbar. Each clip is labelled with its source file. A longer selection is saved **silently
  as text** — no dialog, so you stay in the flow of reading.
- 🔀 **Text vs Region prompt.** A short selection opens a prompt to pick **Clip Text** or
  **Clip Region** (a short highlight is the natural way to "mark this spot" for a figure).
- 🖼️ **Clip Region (image).** Choose **Clip Region**, drag to frame a rectangle, and save it as
  an image clip. It captures the **live, on‑screen reader page**, so it reproduces exactly what
  you see — including **reflowable EPUB** at your chosen font, not just fixed‑layout PDF.
- 📚 **Works across formats.** Text and region clipping from **PDF, EPUB, TXT, CBZ, FB2**, and notes.

### 🗂️ The Clipper dashboard

- 📋 **Unified clip list.** Opened from the plugins sidebar ("Clipper"); text clips show a
  snippet, region clips show a thumbnail — each labelled with its source document.
- 🔢 **Dynamic badge count.** The sidebar button shows the current count, e.g. `Clipper (5)`.
- 🔍 **Search.** Filter by keyword (matches clip text and source name).
- 🏷️ **Filter by source.** Show only clips from a chosen document.
- ↕️ **Sort.** Newest‑first or oldest‑first.

### 🧰 Organizing clips (selection mode)

- ✅ **Select.** Long‑press a clip to enter selection mode, then tap to select more.
- 🔗 **Merge (text).** Combine two or more **text** clips into one, with their sources noted.
- ✂️ **Unmerge.** Break a merged clip back into its individual pieces.
- 📄 **Copy.** Copy the visible or selected clips (combined text) to the system clipboard.
  *(Disabled for a figure — an image can't go on the text clipboard.)*
- 🗑️ **Delete / Clear All.** Remove selected clips, or clear everything.
- 🖼️ **Figure‑alone rule.** A figure can only be selected on its own (it inserts alone and
  can't be copied or merged), keeping every action unambiguous.

### 📝 Inserting into a note

- 🧱 **Combined text block.** Text clips are inserted as **one text box**, separated by a single
  blank line — uniform, tidy spacing (togglable; off = a separate box per clip).
- ✂️ **Long‑clip auto‑split.** A clip too tall for one page is split at a **sentence boundary**;
  the rest continues on the next page.
- 🖼️ **One figure per page.** Images are centred by the system and can't be repositioned, so each
  figure is inserted **alone on its own page** — no overlap, and text never lands on a figure's page.
- 📄 **Current‑page insertion.** Clipper inserts onto the page you're viewing; when more remains,
  it inserts what fits and prompts you to **turn to a new page and Insert again**.

### ⚙️ Settings (gear icon)

- 🧹 **Remove clips after inserting** *(default: on)* — delete clips once inserted, or keep them
  (e.g. to insert the same set into several notes).
- 🧱 **Combine inserted text** *(default: on)* — one block, or a separate box per clip.
- 🔠 **Inserted text size** — **Small / Medium / Large**.

---

## 📦 Installation & Sideloading

1. ⬇️ Download the latest `SnClipper.snplg` from the [Releases](https://github.com/vmnair/Supernote/releases) page.
2. 🔌 Connect your Supernote to your computer via USB.
3. 📁 Copy `SnClipper.snplg` into `/Supernote/MyStyle`.
4. ⚙️ On the device, open **Settings → My Style → Sideloading** and install/update the plugin.
5. ✅ The plugin appears as **Clipper**.

---

## 🚀 Getting Started

1. **Clip while reading.** In a PDF/EPUB/text document, select text and tap **Clip**. For a
   figure, make a short selection, choose **Clip Region**, and frame the area.
2. **Review in the dashboard.** Open the plugins menu → **Clipper** to see, search, filter,
   merge, or delete your clips.
3. **Insert into a note.** Open a note, then in Clipper tap **Insert into open Note**. Text
   flows into one block; figures land one per page. Turn to a new page and Insert again if prompted.

---

## ⚠️ Notes & Limitations

- 🖼️ **Region capture** relies on capturing the live reader view via the plugin host's system
  privileges — required because the SDK can't re‑render reflowable EPUB at the reader's
  font/pagination. It could be affected by a future firmware change.
- 📐 **Images can't be positioned individually** by the plugin (the SDK centres them), so a
  figure is inserted alone on its own page.
- 📄 **Inserting works on the current page only** — the plugin can't turn pages for you. When a
  clip is split or a figure needs its own page, Clipper inserts what fits, then asks you to turn
  to a new page and Insert again.

---

## 🗺️ Roadmap

- ✍️ Highlight selections in the document (clipped text isn't highlighted in place yet).
- 📱 Testing on **Nomad** — I don't own one; feedback from Nomad users is very welcome.

---

## 📄 License

Licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
