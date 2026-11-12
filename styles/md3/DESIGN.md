# Material 3 Expressive: design rules

This style is judged as a Material 3 Expressive app. Where Material Design says
something, that wins; the sources are at the end. Each rule names the code that
carries it (in this folder unless it says `js/`). The rules every style shares are in
[/DESIGN.md](../../DESIGN.md); these are on top of them.

## 1. Structure

- The four places are in the **navigation bar** along the bottom, and in a **rail**
  down the leading edge from 600 px wide (`app.js`). The place you are in has the
  indicator behind its symbol, and its symbol is filled.
- A page has a **top app bar**: Back when there is somewhere to go back to, the title,
  at most three actions and an overflow menu for the rest (`pages.js`, `makePage`). A
  place's own page starts with its title large in the content; it moves up into the
  bar as the page scrolls. The bar takes a container colour once something is under it.
- The one thing a page is for is its **floating action button**: New on Home and
  Scripts, Start Friendly Battle (extended, with its words) on a script. A FAB with more
  than one action opens into a FAB menu (`M.fab`).
- Something to answer is a **dialog**; something to pick through is a **bottom sheet**;
  what just happened is a **snackbar** (`M.dialog`, `M.sheet`, `M.snackbar`).

## 2. Colour

- Every colour is a role of the tonal scheme, worked out from the accent's hue at the
  top of `style.css`: `--primary`, `--secondary-container`, `--surface-container`, and
  the `--on-…` that goes on each. A component never names a raw colour, and text on a
  role is always that role's `on` colour.
- Emphasis is by role, most to least: primary, primary container, secondary container,
  surface containers. One primary thing in view: the FAB, or a filled button.
- Surfaces are told apart by tone (the five `--surface-container…` steps), not by
  lines and not by shadow. Shadow is only for what floats: the FAB, menus, snackbars.
- Error red means something is wrong or will be destroyed, and nothing else.

## 3. Shape

- Corners come from the scale (`--r-xs` 4 … `--r-xl` 28, `--r-full`), used large:
  buttons are fully round, cards 20, the lead card, dialogs and sheets 28.
- **Shape answers.** A button squares off while it is pressed; a toggle that is on is
  squarer than one that is off; in a connected button group the chosen one is the
  round one (`.m-btn:active`, `[aria-pressed]`, `.m-group-btn[aria-checked]`).
- A list is a run of separate items a hair apart; the run has large corners at its two
  ends and small ones between (`.m-list`, `.m-item`). No dividers.

## 4. Motion

- The expressive motion scheme's springs, with the values Compose ships
  (`ui.js`, `M.motion`): **spatial** springs for anything that moves or changes size
  or shape (they may overshoot), **effects** springs for colour and opacity (they never
  do). Fast for small things, default for most, slow for the whole screen.
- Going deeper moves forward along the horizontal axis and Back moves back along it;
  changing place fades through (`app.js`, `apply`).
- A press shows where it landed: a state layer in the content's own colour and ink
  from the point of touch (`.m-press`).
- Waiting is the loading indicator, a shape that keeps becoming another (`M.loading`).

## 5. Type and symbols

- Roboto Flex. Titles and the names of things are emphasized (heavier); body is
  regular. Sizes are the type scale's: 36 for a page's large title, 28 headline, 22
  title, 16 body, 14 label, 12 for the smallest labels.
- Symbols are Material Symbols Rounded, by name (`M.icon`); filled for what is chosen
  or on. They stay hidden until the font has loaded, and if it never does the app's own
  drawings stand in.

## 6. Components

Use the component Material has for the job (`ui.js`):

| For | Component |
| --- | --- |
| The main action of a region | Filled button; tonal for the ones beside it; text in dialogs |
| An action that is a symbol | Icon button (standard; tonal or filled when it must stand out) |
| On or off | Switch (`M.switch`) |
| One of a few, all in view | Connected button group (`M.group`) |
| One of many | A menu from the item's value (`pickItem`) |
| A number in a range | Slider (`M.slider`) |
| Typing | Outlined text field (`M.field`); a search bar for searching |
| Things to open | Cards in a grid or a carousel; list items for dense runs |

## Sources

- [Material Design 3](https://m3.material.io/): colour roles, shape, typography,
  components, navigation, as read on 2026-11-12.
- Material 3 Expressive: shape that responds, the FAB menu, button groups, the loading
  indicator, the flexible navigation bar.
- Jetpack Compose `material3`, `ExpressiveMotionTokens.kt`: the spring values
  (spatial 380 / 0.8, fast 800 / 0.6, slow 200 / 0.8; effects 1600, 3800 and 800,
  all critically damped).
