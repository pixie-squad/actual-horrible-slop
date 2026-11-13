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
- A test run is a **standard side sheet** on the trailing edge of the editor from 840
  wide, opened by Test in the app bar (`tests.js`, `editor.js`). It is coplanar with
  the code: no shadow, a divider on its leading edge, and the code narrows to make
  room as it slides in. The guidelines fix its width without giving one; it is 360.
  Below 840 it is a bottom sheet, as the files are (for a phone the guidelines would
  have a modal side sheet). Under its heading, Output and State are tabs; State is the
  battle's objects as choice chips, a search bar and a data table.

## 4. Components

- Buttons are in **capitals**, medium weight, tracked out: contained (primary, with a
  shadow that deepens on press) for the main action, outlined beside it, text in cards
  and dialogs. Their shape does not change.
- Text fields are **filled**: a tinted box with a line under it that turns primary
  and thickens when it has the keyboard (`M.field`).
- A switch is a round thumb on a narrow track; a slider is a thin line with a round
  thumb (`M.switch`, `M.slider`).
- Waiting is a ring that turns (`M.loading`).
- How far along is the **linear progress indicator** (`tests.js`): 4 high and edge to
  edge, primary on a #e6e6e6 track (12 % white in the dark, `--track`). Determinate,
  the bar grows over 250 ms on the sharp curve (0.4, 0, 0.6, 1); with no telling, two
  bars cross the track in a 2 s cycle; once it is over it fades over 250 ms.
- One of a few kinds is a **choice chip** (`tests.js`): 32 high and round, body 2, 12
  either side, on surface at 10 % (`--chip`); the chosen one primary at 24 % with its
  label in primary, and no check, so it is as wide chosen as not.
- Values in rows and columns are Material Components' **data table** at its densest
  (`tests.js`): rows 36, the heading 40, 16 at either end of a cell, a divider under
  each; the heading subtitle 2 and the rows body 2, numbers to the right in tabular
  figures, a row under the pointer at the fill, this client's own row medium. The
  heading stays while the rows scroll; the columns are as wide as every object in sight
  needs, so a filter never moves them, and where they do not fit the table moves
  sideways.

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
- Material Components for the web, `packages/mdc-linear-progress` (`_linear-progress.scss`,
  `_linear-progress-theme.scss`; read 2026-11-13): the progress indicator's height,
  track colour, keyframes and timing.
- Material Components for the web, `packages/mdc-data-table/_data-table-theme.scss` and
  `packages/mdc-density/_density.scss` (read 2026-11-13): the data table's rows, heading,
  cell padding, lines, text and hover, and its density (4 a step, down to rows of 36).
- Material Components for Android, `chip/res/values/styles.xml` and
  `chip/res/color/mtrl_choice_chip_*.xml` (read 2026-11-13): the choice chip's height,
  padding, type and colours.
- The guidelines' side sheets page (Sheets: side): standard side sheets, coplanar or
  raised, a fixed width, on tablet and desktop.
