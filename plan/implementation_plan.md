# Implementation Plan: On-Device Icon Showcase

**Target Device:** Supernote Manta A5X2, Chauvet 3.29.43_beta  
**Branch:** `release/0.3.0`  

---

## 1. Goal
Provide the user with an on-device visual showcase of all 5 icon concepts rendered directly on the Supernote E-Ink hardware screen at both full scale and sidebar scale (24×24dp), enabling the user to evaluate and select the best design.

---

## 2. Proposed Implementation

1. **Asset Generation in `scripts/generate_icons.py`:**
   - Add the 5 generator functions to `scripts/generate_icons.py` so they output:
     - `assets/icon/concept_1_paperclip.png`
     - `assets/icon/concept_2_scissors.png`
     - `assets/icon/concept_3_stack.png`
     - `assets/icon/concept_4_highlighter.png`
     - `assets/icon/concept_5_bookmark.png`
2. **On-Device Icon Showcase View:**
   - In Settings or via a top banner button, show an **"Icon Preview (1-5)"** card with each icon displayed at:
     - Large Preview (80×80)
     - Exact Sidebar Size (28×28)
     - Concept Name & Number
3. **Build & Deploy:**
   - Run `npm test`.
   - Run `./deploy.sh` to update Supernote to build 301.
   - User reviews all 5 on device and picks the winner.
4. **Finalization:**
   - Copy chosen concept to `assets/icon/icon.png`.
   - Clean up temporary showcase code.
