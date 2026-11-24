# Coversight UI system

One scale for the whole app, so every page looks like it came from the same
team. Values live in `app/system.css` (loaded last); colours stay in
`app/theme.css` (Persimmon & Ink). Use these, never a new value beside them.

| Part | The rule |
|---|---|
| Type | 13, 15, 17, 20, 25, 28, 36, 44 px. 12 only inside charts. Body 17, labels 13 to 15, card titles 20, page headline 36, hero number 44. |
| Weight | 400 body, 500 labels, 600 titles and figures, 700 hero numbers only. No 800. |
| Case | Sentence case everywhere. No uppercase eyebrows, no letter-spaced labels. |
| Space | 4-px grid: 4, 8, 12, 16, 24, 32, 48. Page column 1200 px with 32 px gutters (16 on a phone). |
| Radius | `--r-ctl` 8 px for buttons, inputs, chips and tiles inside a card. `--r-box` 12 px for cards, panels and dialogs. Pills only for dots and avatars. |
| Elevation | `--shadow-box` on resting surfaces, always with a 1 px border. `--shadow-pop` only for things that float (menus, dialogs, drawers). No glow under buttons, no lift on hover. |
| Colour | Persimmon is the one action and the selected thing. Ink is structure and data. Green good, red problem, amber caution, each with an icon and a word. |
| Never | Gradients on surfaces, coloured stripes on the edge of a card, sparkle icons for AI, emoji, a second filled button on a page. |
| Motion | 150 ms ease-out on colour, background, border and shadow. Nothing moves when the device asks for reduced motion. |
| Tabs | One style: underline tabs (`.cv-pagetabs`). Segmented controls show the chosen option as a white tile with a hairline, never a coloured ring. |
| Figures | Tabular numbers on the whole app (set on `body`). |
| Loading | `.cv-skel` shapes where the content will be, never a blank page or the word "Loading". Heavy work (Covercast, Sous) runs after the first paint and is cached per room. |
| Empty and error | `.cv-empty` for nothing-here-yet; `app/error.tsx` offers Try again first, then a reset. |

The shell follows the same rules: the sidebar and top bar sit flush to the
window edge, the top bar carries a small page name (the page's own headline is
the big one), and the AI teammate's button is a normal secondary button.
