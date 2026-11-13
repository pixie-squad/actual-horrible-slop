# Material 3 Expressive: design rules

This style is judged as a Material 3 Expressive app, as one looks on a Pixel. Where
Material says something, that wins. Each rule gives the value used and the token it is
(the names are Compose Material 3's token files, listed under Sources), and names the
code that carries it (in this folder unless it says `js/`). Sizes are in px, one to a
dp. The rules every style shares are in [/DESIGN.md](../../DESIGN.md); these are on
top of them.

## 1. Structure

- The four places are in the **navigation bar** under 600 wide and the **navigation
  rail** from there (`app.js`). The place you are in has the indicator behind its
  symbol, its symbol filled and its label in secondary.

  | | Value | Token |
  | --- | --- | --- |
  | Bar | 64 high, surface container | `NavigationBarTokens.ContainerHeight`, `ContainerColor` |
  | Rail | 96 wide, 44 above the first item, items 64 high and 4 apart | `NavigationRailCollapsedTokens`, `NavigationRailBaselineItemTokens` |
  | Indicator | 56 × 32, round, secondary container | `NavigationBarVerticalItemTokens` |
  | Label | label-medium, 4 under the indicator; secondary when active | `NavigationBarTokens` |

- A page has a **top app bar**: 64 high, 4 at either end, the title title-large, a
  subtitle label-medium (`AppBarTokens`, `AppBarSmallTokens`); Back when there is
  somewhere to go back to, at most three actions and an overflow menu (`pages.js`,
  `makePage`). A place's own title starts large under the bar, display-small as the
  large flexible app bar's is (`AppBarLargeFlexibleTokens`), and moves up into the bar
  as the page scrolls. The bar changes colour once something is under it.
- The one thing a page is for is its **floating action button**: New on Home and
  Scripts, Start Friendly Battle (extended) on a script. One with more than one action
  opens into the FAB menu (`M.fab`).
- Something to answer is a **dialog**; something to pick through is a **bottom sheet**;
  what just happened is a **snackbar** (`M.dialog`, `M.sheet`, `M.snackbar`).
- A test run is the editor's **supporting pane** (`tests.js`, `editor.js`), opened by
  Test, an icon button in the app bar. From 840 wide it is a pane on the trailing side
  of the code, 360 wide and 412 from 1200 (`PaneScaffoldDirective.DefaultPreferredWidth`,
  `DefaultPreferredWidthXL`); below that it is a bottom sheet. The pane is 12 from the
  code, the editor's own gap, not the scaffold's spacer of 24. Under its heading,
  Output or State is a connected button group; State is the battle's objects as filter
  chips, a search bar and a data table.

## 2. Colour

- Every colour is a role of the tonal scheme, worked out from the accent's hue at the
  top of `style.css`. A role is a tone of a palette, and a tone T is OKLCH lightness
  (T + 16) / 116; the tones are Material's (primary 40, its container 90, text on the
  container 30; surfaces 98, 96, 94, 92, 90; dark: 80, 30, 90; 6, 10, 12, 17, 22, and
  24 for the bright surface). A component never names a raw colour, and text on a role
  is that role's `on` colour.
- **The page is surface container, and what lies on it is the bright surface**
  (`--page`, `--piece`): list items, cards, the search bar. That is how the segmented
  list is meant to be seen (its items are `colorSurfaceBright` in Material Components)
  and it holds in both themes. Dialogs are surface container high, sheets and menus
  surface container low.
- Emphasis is by role, most to least: primary, primary container, secondary container,
  the surfaces. One primary thing in view.
- Shadow is only for what floats (`--elev-1` … `--elev-4`, `ElevationTokens` levels
  1 to 4): the FAB and its menu 3 (4 under the pointer), menus 2, dialogs and
  snackbars 3, a sheet 1, a card or a filled button under the pointer 1.
- Error red means something is wrong or will be destroyed, and nothing else. A
  favorite that is on is the filled heart in its button's own colours, not red.
- States (`StateTokens`): under the pointer a layer of the content's colour at 8 %,
  with the keyboard on it 10 %. A press is the **ripple** alone, 10 %, from where it
  landed (`ui.js`, `ripple`): in over 75 ms, out to its full size over 225 ms, gone
  over 150 ms after the press is let go.

## 3. Shape

- Corners are the scale (`ShapeTokens`): 4, 8, 12, 16, 20, 28, and round.
- **A corner that animates is always a length.** Round is half the component's height,
  written out (20 for a 40 button), never a huge number: a morph from a huge number
  shows nothing until its last moment and then overshoots to a square. Every frame of
  a press is somewhere between the two shapes.
- **Shape answers.**

  | Component | At rest | Pressed | Chosen / on | Token |
  | --- | --- | --- | --- | --- |
  | Button, 40 | 20 | 8 | | `ButtonSmallTokens` |
  | Button, 56 (`size: 'md'`) | 28 | 12 | | `ButtonMediumTokens` |
  | Icon button, 40 | 20 | 8 | 12 | `SmallIconButtonTokens` |
  | Connected group: between two buttons | 8 | 4 | 20 | `ConnectedButtonGroupSmallTokens` |
  | Connected group: outer corners | 20 | 20 | 20 | the same |
  | List item: between two items | 4 | 16 | | `ListTokens`; 12 under the pointer |
  | List item: the list's own corners | 16 | 16 | | `ListTokens.ContainerShape` |
  | Menu item | 4, 12 at its group's corners | | 12 | `SegmentedMenuTokens` |
  | FAB | 16 | 16 | 28 as the close button | `FabBaselineTokens`, `FabMenuBaselineTokens` |

- A card is 12 (`FilledCardTokens`), a carousel's item 28, a dialog and a sheet's top
  28, a text field and a snackbar 4. A card's corner and the FAB's do not answer a press.

## 4. Motion

- The expressive scheme's springs (`ExpressiveMotionTokens`; `ui.js`, `M.motion`), as
  stiffness / damping ratio: spatial 380 / 0.8, fast 800 / 0.6, slow 200 / 0.8; effects
  1600, fast 3800, slow 800, all critically damped. **Spatial** springs are for what
  moves or changes size and may overshoot; **effects** springs are for colour and
  opacity and never do.
- A component uses the spring its Compose source uses:

  | What | Spring | Source |
  | --- | --- | --- |
  | A button's or icon button's corner on a press | effects (no bounce, on purpose) | `Button.kt`, `IconButton.kt` |
  | A group button's corners, a list item's, a switch's handle, a slider's handle | fast spatial | `ToggleButton.kt`, `ListItem.kt`, `Switch.kt` |
  | A menu: grows from 0.8 as it fades in, and leaves the same way | fast spatial, fast effects | `Menu.kt` |
  | The FAB menu: each item grows from its trailing edge as it fades in, the nearest first; closing is the reverse | fast spatial, fast effects; counted in on slow effects | `FloatingActionButtonMenu.kt` |
  | The FAB becoming the close button | fast spatial | the same |
  | The navigation indicator | spatial | `NavigationItem.kt` |
  | The supporting pane: it slides in from the trailing edge, and out again, while the code narrows and widens | spatial | `PaneMotion.kt` (`PaneMotionDefaults`, `EnterFromRight`) |

- Going deeper moves forward along the horizontal axis and Back moves back along it;
  changing place fades through (`app.js`, `apply`).
- Waiting is the **loading indicator** (`LoadingIndicator.kt`, `LoadingIndicatorTokens`):
  a 38 shape in a 48 container that becomes the next of seven of Material's shapes
  (soft burst, 9-sided cookie, pentagon, pill, sunny, 4-sided cookie, oval) every
  650 ms on a spring of 200 / 0.6, turning a quarter each time, while the whole turns
  once in 4666 ms. The shapes are built from their definitions in `MaterialShapes.kt`
  (`ui.js`, `loadingShapes`).

## 5. Type and symbols

- Roboto Flex, on the type scale (`TypeScaleTokens`), with its tracking:

  | Style | Size / line | Weight | Tracking | Used for |
  | --- | --- | --- | --- | --- |
  | display-small | 36 / 44 | 500 | 0 | a place's large title |
  | headline-large, display-medium | 32 / 40, 45 / 52 | 500 | 0 | the lead card's title, narrow and wide |
  | headline-medium | 28 / 36 | 500 | 0 | the name a page is about |
  | headline-small | 24 / 32 | 400 | 0 | a dialog's headline |
  | title-large | 22 / 28 | 400; 500 for a section | 0 | the bar's title, section headings |
  | title-medium | 16 / 24 | 500 | 0.15 | a card's title, 56 buttons, the FAB's words |
  | body-large | 16 / 24 | 400 | 0.5 | list items, fields, menus |
  | body-medium | 14 / 20 | 400 | 0.25 | supporting text, dialogs, snackbars |
  | label-large | 14 / 20 | 500 | 0.1 | buttons |
  | label-medium | 12 / 16 | 500; 700 when active | 0.5 | navigation, badges |
  | label-small | 11 / 16 | 500 | 0.5 | a list item's trailing text |

  The 500 on display, headline and section titles is the emphasized set of the scale.
- Symbols are Material Symbols Rounded, by name (`M.icon`), 24, 20 in a 40 button and
  in menus; filled for what is chosen or on. They stay hidden until the font has
  loaded, and if it never does the app's own drawings stand in.

## 6. Components

Use the component Material has for the job (`ui.js`):

| For | Component | Measures (token) |
| --- | --- | --- |
| The main action of a region | Filled button; tonal beside it; elevated on a coloured container; text in dialogs | 40 high, 16 at either end, 8 to a 20 symbol (`ButtonSmallTokens`) |
| The action a screen leads with | The same at 56 | 24 at either end, a 24 symbol (`ButtonMediumTokens`) |
| An action that is a symbol | Icon button: standard; tonal or filled to stand out | a 40 container in a 48 target (`SmallIconButtonTokens`) |
| On or off | Switch (`M.switch`) | 52 × 32 track, 2 outline; handle 16, 24 on, 28 pressed, a 16 check; a 40 state layer (`SwitchTokens`) |
| One of a few, all in view | Connected button group (`M.group`) | 40 high, 2 apart (`ConnectedButtonGroupSmallTokens`); it does not widen on a press, only a standard group does |
| One of many | A menu from the item's value (`pickItem`) | |
| A number in a range | Slider (`M.slider`) | 16 track, 4 × 44 handle with 6 either side, 2 while held, a 4 stop at the end (`SliderTokens`) |
| Typing | Outlined text field (`M.field`); a search bar for searching | 56 high; the search bar round (`OutlinedTextFieldTokens`, `SearchBarTokens`) |
| Things to open | Cards in a grid or a row; list items for dense runs | list item 56 for one line, 16 at either end, items 2 apart (`ListTokens`) |
| The page's one action | FAB; extended with its words | 56, a 24 symbol; extended 16 at either end and 8 to the words (`FabBaselineTokens`, `ExtendedFabSmallTokens`) |
| More than one such action | FAB menu | items 56 high, round, 24 at either end, 4 apart, 8 above the close button, which is 56, round, primary, a 20 symbol (`FabMenuBaselineTokens`) |
| Choices from a control | Menu (`M.menu`) | groups 2 apart instead of dividers, each a 16 container with 4 around; items 44 high, 12 at either end, a 20 symbol; the chosen one tertiary container (`SegmentedMenuTokens`, `StandardMenuTokens`) |
| A question | Dialog | 28 corner, 24 around, a 24 symbol in secondary (`DialogTokens`) |
| A panel from the bottom | Bottom sheet | 28 top corners, a 32 × 4 handle (`SheetBottomTokens`) |
| What just happened | Snackbar | 48 for one line, 4 corner, inverse surface (`SnackbarTokens`) |
| One kind of many, to narrow what is listed | Filter chips (`tests.js`) | 32 high, the 8 corner, a 1 outline of outline variant, label-large in on surface variant, 16 either side; the chosen one secondary container with an 18 check, 8 before it and 8 to the label (`FilterChipTokens`, `Chip.kt`) |
| Values in rows and columns | Data table (`tests.js`) | M3 has none, so it is Material's data table at its densest (`mdc-data-table`: rows 36, the heading 40, 16 at either end of a cell, a 1 line of outline variant under each) in this style's roles: the heading label-large in on surface variant, the rows body-medium, numbers to the right in tabular figures, this client's own row at 500. The heading stays while the rows scroll; the columns are as wide as every object in sight needs, so a filter never moves them, and where they do not fit the table moves sideways. Its search bar is surface container high on the pane (`SearchBarTokens`) |
| How far along | Linear progress indicator (`tests.js`) | 4 thick, primary on a secondary container track, round ends 4 apart, a 4 stop of primary at the end; it follows its value on stiffness 50, no bounce; with no telling, two lines whose heads and tails run on emphasized accelerate (0.3, 0, 0.8, 0.15) in 1750 ms (`LinearProgressIndicatorTokens`, `ProgressIndicatorTokens`, `MotionTokens`, `ProgressIndicator.kt`) |

## Sources

Read on 2026-11-12.

- Jetpack Compose `material3`, branch `androidx-main`, under
  `compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/`:
  - `tokens/`: `ShapeTokens`, `TypeScaleTokens`, `ElevationTokens`, `StateTokens`,
    `ExpressiveMotionTokens`, `ButtonSmallTokens`, `ButtonMediumTokens`,
    `SmallIconButtonTokens`, `FilledIconButtonTokens`, `FilledTonalIconButtonTokens`,
    `ConnectedButtonGroupSmallTokens`, `ButtonGroupSmallTokens`, `FabBaselineTokens`,
    `FabPrimaryContainerTokens`, `ExtendedFabSmallTokens`, `FabMenuBaselineTokens`,
    `NavigationBarTokens`, `NavigationBarVerticalItemTokens`,
    `NavigationRailCollapsedTokens`, `NavigationRailBaselineItemTokens`,
    `NavigationRailVerticalItemTokens`, `AppBarTokens`, `AppBarSmallTokens`,
    `AppBarLargeFlexibleTokens`, `SearchBarTokens`, `SwitchTokens`, `SliderTokens`,
    `ListTokens`, `LoadingIndicatorTokens`, `SegmentedMenuTokens`, `StandardMenuTokens`,
    `DialogTokens`, `SheetBottomTokens`, `SnackbarTokens`, `OutlinedTextFieldTokens`,
    `FilledCardTokens`, and (read 2026-11-13) `LinearProgressIndicatorTokens`,
    `ProgressIndicatorTokens`, `MotionTokens`, `FilterChipTokens`.
  - the components, for behaviour: `Button.kt`, `IconButton.kt`, `ToggleButton.kt`,
    `ButtonGroup.kt`, `FloatingActionButtonMenu.kt`, `ListItem.kt`, `Menu.kt`,
    `Switch.kt`, `NavigationItem.kt`, `LoadingIndicator.kt`, `MaterialShapes.kt`,
    `internal/AnimatedShape.kt`, `ProgressIndicator.kt`, `Chip.kt`.
- Material Components for the web, `packages/mdc-data-table/_data-table-theme.scss` and
  `packages/mdc-density/_density.scss` (read 2026-11-13): the data table's rows,
  heading, cell padding and lines, and its density (4 a step, down to rows of 36).
- Jetpack Compose `material3-adaptive`, the same branch, under
  `compose/material3/adaptive/adaptive-layout/src/commonMain/kotlin/androidx/compose/material3/adaptive/layout/`
  (read 2026-11-13): `PaneScaffoldDirective.kt` (pane widths and spacers by window
  width), `PaneMotion.kt` (how panes come and go, and their spring).
- Material Components for Android, `docs/components/`: `ButtonGroup.md`, `List.md`
  (the segmented list's colour), `Card.md`, `Carousel.md`, `FloatingActionButton.md`,
  `NavigationRail.md`, `TopAppBar.md`.
- [Material Design 3](https://m3.material.io/) for how the components are meant to be
  used. Its pages are drawn by script and could not be read by this style's author;
  the numbers above are from the code.
