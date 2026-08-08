# FocusStream Design System

Here is a comprehensive summary of the new design system for the FocusStream timeline view. This is structured to outline the architecture, state logic, and CSS properties required to implement the redesigned "Lifestreams" view.

## 1. Core Timeline Architecture
The timeline is shifting from a variable-height, multi-color layout to a uniform-height, monochrome baseline that uses luminance and borders to convey information.

Events are still shown a indivual visits or as a combined container view. The main difference is that contained children visits are all the same shorter height


---

## 2. The Monochrome & Border Color System
All blocks have been stripped of arbitrary domain colors to prevent visual clutter and color-clashing with favicons. The UI assumes a dark-mode canvas (e.g., `#141414`).

| State | Background Fill | Border (1px Solid) | Visual Goal |
| :--- | :--- | :--- | :--- |
| **Unimportant** | `#262626` (Deep Gray) | `#3A3A3A` (Subtle Gray) | Recedes into the background; border prevents adjacent blocks from "blobbing" together. |
| **Important (Aggregate)** | `#3D3D3D` (Mid-Tone Gray) | `#6B6B6B` (Crisp Silver) | Noticeably brighter luminance to draw the eye, with a crisp edge to elevate it. |

---

## 3. Favicon Display Logic (The 2x2 Matrix)
To solve the geometry problem of "thin" events and to further reduce visual noise, favicon rendering is determined by both the **importance** of the visit and the **physical width** of the rendered block.

| Status | Wide Enough (Fits >16px) | Not Wide Enough (Thin) |
| :--- | :--- | :--- |
| **Important** | **Full Color.** Rendered inside the block. | **"Pin / Lollipop".** A 1px silver line (`#6B6B6B`) extends up from the block to a full-color favicon floating above the timeline. |
| **Unimportant** | **Grayscale.** Rendered inside the block using CSS `filter: grayscale(100%) opacity(60%)`. | **No Favicon.** The block remains an empty, neutral sliver. |

---

## 4. Special case for earned high events
To differentiate earned-high sessions, a semantic accent border is applied.

*   **Fill:** `#3D3D3D` (Standard Important Fill).
*   **Border:** `1px solid #D4AF37` (Muted Gold)
*   **Effect:** The colored border acts as a highlighter for tentpole events in the user's day without introducing a heavy block of color that would clash with the favicon. 

---

## 5. Day Browser
The day browser at the top of the UI is still a smaller form of the full day view but as the view is not much less colorful, each day is now visually simpler. These smaller day views do NOT display favicons. Mark earned high events as simple block using it's special border color. 