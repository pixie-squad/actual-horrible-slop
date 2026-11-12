# Material Design 2: design rules

This style is judged as a Material Design app of the second generation (2018). Where
the Material guidelines of that time say something, that wins; the sources are at the
end. Each rule names the code that carries it (in this folder unless it says `js/`).
The rules every style shares are in [/DESIGN.md](../../DESIGN.md); these are on top
of them.

It began as a copy of the Material 3 Expressive style and keeps its structure: the
four places in the navigation, a top app bar on every page, a floating action button
for what the page is for, dialogs, bottom sheets and snackbars. What follows is where
Material Design 2 differs.

## 1. Surfaces and elevation

- Everything is **paper**: white sheets on a slightly grey page (`--surface` on
  `--background`). What is above something casts a shadow on it, and **height is the
  only thing that parts surfaces**: cards at 1, the app bar at 4, the floating action
  button at 6, bottom navigation and menus at 8, dialogs at 24 (`--dp1` … `--dp24`).
- No tonal containers and no large corners. Corners are 4 px (`--r`); only the
  floating action button, avatars and icon buttons are round.
- In the dark theme surfaces are near black and get lighter with height; the app bar
  is a surface, not the primary colour.

## 2. Colour

- **Primary** is the accent: the app bar, the place you are in, the tab that is
  chosen, text buttons and links (`--primary`). In the dark theme it is the accent's
  light tone.
- **Secondary** is one colour that goes with it: the floating action button, switches
  and sliders, a favourite's heart (`--secondary`). It is never used for text.
- Text is black or white at three strengths: 87 % for what is read, 60 % for what
  supports it, 38 % for what is disabled or a hint (`--on-surface`, `-2`, `-3`).
- Lines between rows are 12 % (`--divider`). Error is the one red.

## 3. Structure

- The **top app bar** is the primary colour with the title and symbols in white. The
  title is always in the bar; there is no large title in the content.
- **Bottom navigation** has no indicator shape: the place you are in is the primary
  colour and its label a size larger. From 600 px it is a rail.
- A choice between views of a list is **tabs** above it, the chosen one underlined in
  the primary colour (`.m-filter .m-group`). Elsewhere the same choice is a group of
  joined toggle buttons.
- A list is one sheet with a line between its rows (`.m-list`).
- A floating action button with more than one action opens a **speed dial**: small
  round buttons above it, each with its name beside it (`M.fab`).

## 4. Components

- Buttons are in **capitals**, medium weight, tracked out: contained (primary, with a
  shadow that deepens on press) for the main action, outlined beside it, text in cards
  and dialogs. Their shape does not change.
- Text fields are **filled**: a tinted box with a line under it that turns primary
  and thickens when it has the keyboard (`M.field`).
- A switch is a round thumb on a narrow track; a slider is a thin line with a round
  thumb (`M.switch`, `M.slider`).
- Waiting is a ring that turns (`M.loading`).

## 5. Motion

- The **standard curve** (`cubic-bezier(0.4, 0, 0.2, 1)`), 150 to 375 ms by how far a
  thing travels (`ui.js`, `M.motion`). Nothing overshoots and nothing springs.
- A press spreads ink from where it landed (`.m-press`).
- Going deeper moves forward along the horizontal axis; changing place fades through.

## 6. Type and icons

- Roboto, on the 2018 scale: 34 and 24 for headlines, 20 medium for titles, 16 for
  body, 14 for secondary text and (in capitals) buttons, 12 for captions, 10 in
  capitals for overlines.
- Icons are Material Icons, filled (`M.icon`). A heart that is not a favourite is
  the outlined one.

## Sources

- [Material Design](https://m2.material.io/) (the 2018 guidelines): elevation, colour
  system, typography scale, components, motion's standard easing.
- Material Components' published elevation shadows, for `--dp*`.
