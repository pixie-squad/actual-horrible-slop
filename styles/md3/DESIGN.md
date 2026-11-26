# Material 3 Expressive: design rules

This style is judged as a Material 3 Expressive app, as one looks on a Pixel. Where
Material says something, that wins. Each rule gives the value used and the token it is
(the names are Compose Material 3's token files, listed under Sources), and names the
code that carries it (in this folder unless it says `js/`). Sizes are in px, one to a
dp. The rules every style shares are in [/DESIGN.md](../../DESIGN.md); these are on
top of them.

Expressive is not decoration put on Material 3. It is how the app **answers**: what is
pressed gives and springs back, what is chosen changes shape, what comes onto the
screen moves into place and what is around it makes room, all on springs (§4). Then it
is hierarchy: the one thing a screen is for is larger and in the primary colour, type
that matters is heavier, and things that belong together share a container. The
colour is one family of hue, calm, as a Pixel makes from a wallpaper. A screen where
something appears or changes without moving is not this style, however it is coloured;
neither is one dressed up with shapes and contrasting colours that mean nothing.
Material's own example screens are the reference for how quiet the result is (Sources).

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
  opens into the FAB menu (`M.fab`). It is the medium FAB, which Material recommends
  for most windows, and the large one from 840 wide; the small FAB and the surface
  colours are not used.
- Home leads with the script last worked on (or the newest published) as its **hero
  moment** (`pages.js`, `lead`; `.m-hero`), made of size and type alone: its picture
  large in a card of the primary container, the name in display type, and 56 buttons.

- Something to answer is a **dialog**; something to pick through is a **bottom sheet**;
  what just happened is a **snackbar** (`M.dialog`, `M.sheet`, `M.snackbar`).
- A test run is the editor's **supporting pane** (`tests.js`, `editor.js`), opened by
  Test, an icon button in the app bar. From 840 wide it is a pane on the trailing side
  of the code, 360 wide and 412 from 1200 (`PaneScaffoldDirective.DefaultPreferredWidth`,
  `DefaultPreferredWidthXL`); below that it is a bottom sheet. The pane is 12 from the
  code, the editor's own gap, not the scaffold's spacer of 24. Its heading is the run's
  title with the pane's icon buttons (Test Settings, Close), and under it the detail
  with the tonal button that acts on the run. Under the heading, Output or State is a
  connected button group; State is the battle's objects as filter chips, a search bar
  and a data table.
- Test Settings (from the pane's heading and the More menu) and History are bottom
  sheets of segmented lists, with a heading between lists in label-large and primary
  (`tests.js`, `editor.js`, `.m-settings`). A change in Test Settings holds at once.
  A save in History opens on what it changes in a basic dialog 560 wide (Compose's
  `DialogMaxWidth`) with Cancel and Restore, and on a compact window in a
  **full-screen dialog**: a 64 bar on the surface with Close, the headline in
  title-large and Restore as a text button (`M.dialog`, `full`).
- What waits for Save is a checkbox, so Library in Details is one (`M.check`).

## 2. Colour

- Every colour is a role of a scheme that **Material's own colour library** works out
  from the accent's source colour: Material Color Utilities, the 2025 colour spec that
  came with M3 Expressive, its **Tonal Spot** variant (the one a Pixel uses), for a
  phone, at standard contrast. `tools/md3-colors.js` runs it and writes the roles of
  every accent in both themes at the top of `style.css`; an accent is added there,
  never by hand. A component never names a raw colour, and text on a role is that
  role's `on` colour.
- The scheme is **one family of hue**: primary is the accent, secondary the same hue
  with less colour in it, tertiary a near neighbour, and the surfaces carry a little of
  it. Nothing on a screen contrasts in hue with the rest of it. (The library's
  Expressive variant, which turns secondary and tertiary to other hues, was tried and
  is not used: green beside blue on every screen is loud, and is not what Material's
  own example screens look like.)
- What the three are for: **primary** is the action a screen is for and what is chosen
  (the FAB, a filled button, the chosen button of a group, a figure on a profile);
  **secondary** is what stands back (tonal buttons, the navigation indicator, a list
  item's symbol, an empty state's symbol); **tertiary** is used small (the chosen menu
  item, strings in code). In a list of different kinds of thing the symbols take the
  three in turn (`M.item`, `tint`).
- On a container colour a control takes a pair that stands out from that container in
  both themes: on the lead card the filled button is the card's own `on` colour and
  the other is the bright surface (`.m-hero .m-btn`). A badge on a picture is the
  bright surface too.
- Code is drawn in the scheme too (`--tk-…`): keywords and types primary, strings and
  numbers tertiary, what is called secondary, on the lowest surface (a low container
  in the dark theme, where the lowest is black).

- **The page is surface container, and what lies on it is the bright surface**
  (`--page`, `--piece`): list items, cards, the search bar. That is how the segmented
  list is meant to be seen (its items are `colorSurfaceBright` in Material Components)
  and it holds in both themes. Dialogs are surface container high, sheets and menus
  surface container low.
- Emphasis is by role, most to least: primary, primary container, secondary container,
  the surfaces. One primary thing in view. Size says it too: the action a screen leads
  with is a larger button than the ones beside it, never the same size in another
  colour only.
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

- Corners are the scale (`ShapeTokens`, and the corner radius scale in Sources): 4, 8,
  12, 16, 20, 28, 32, 48, and round. Round and nearly square are used side by side on
  purpose: the tension between them is part of the look.
- **Nested corners are not the same radius.** The inner one is the outer one less the
  padding between them: a card is 28 with 8 around its picture, so the picture is 20.
- **Material's shape library is the loading indicator's, and nothing else's here.**
  Pictures, figures and symbols are round or on the corner scale. Cookies and bursts
  as decoration were tried (a profile picture, the figures, the lead card's artwork)
  and taken out: in an app of lists and code they read as stickers.

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
  | Button, 32 (`size: 'xs'`) | 16 | 8 | | `ButtonXSmallTokens` |
  | Button, 96 (`size: 'lg'`) | 48 | 16 | | `ButtonLargeTokens` |
  | FAB, 80 | 20 | 20 | 28 as the close button | `FabMediumTokens`, `FabMenuBaselineTokens` |
  | FAB, 96 | 28 | 28 | 28 as the close button | `FabLargeTokens` |

- A card that leads with a picture and a carousel's item are 28, the lead card 32 and
  48 from 840 wide, a dialog and a sheet's top 28, a text field and a snackbar 4. A
  card's corner and the FAB's do not answer a press.

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
  | A full-screen dialog: it comes up from the bottom edge as a sheet does (running 48 past it, so the overshoot shows more of it), and goes back down | spatial; effects leaving | the sheet's, here (`M.dialog`) |

- **Nothing appears, goes or changes size without moving**, and what is around it moves
  with it. Where Compose has no component for it, the springs are these:

  | What | How | Spring | Code |
  | --- | --- | --- | --- |
  | Something comes into a form or leaves it (the name's field when Sign In turns to Create Account, the line that says what went wrong) | its height opens or shuts, with the gap its parent keeps, while it fades; the dialog grows with it | spatial, effects | `M.reveal` |
  | A button says something else (Log In, Create Account) | it widens or narrows to its words | fast spatial | `M.relabel` |
  | What a page has read takes the loading indicator's place; another list is chosen on Scripts | each piece rises 20 into place as it fades in, 35 ms after the one before | spatial, effects | `M.arrive`; `pages.js`, `wait` |
  | Buttons side by side (a standard button group): one is pressed | it widens by about 15 % and those beside it give way by as much, so the row keeps its width | fast spatial | `.m-actions` (`ButtonGroup.kt`, `ExpandedRatio`) |
  | A toggle's symbol under a press (the heart) | it shrinks to 0.72 and springs back | fast spatial | `.m-fav` |

- **A change that can be interrupted is the component's own state, not a script's
  animation.** The heart's fill, its button's shape and its press are CSS on the
  button, so a second press part way through turns the change round from where it is;
  nothing is started again from the beginning. What a favorite changes elsewhere on a
  page is drawn once the heart has been let alone for 900 ms (`pages.js`, `settled`),
  and until then every heart of that script on the page follows the one pressed.
- What opens from a control shuts on a second press of that control: the press that
  shuts a menu is not also taken as a press to open it (`M.menu`).
- A slider has no spring of its own beyond its handle narrowing while held; its value
  follows the finger exactly, as Compose's does.
- Going deeper moves forward along the horizontal axis and Back moves back along it;
  changing place fades through (`app.js`, `apply`).
- Waiting is the **loading indicator** (`LoadingIndicator.kt`, `LoadingIndicatorTokens`):
  a 38 shape in a 48 container that becomes the next of seven of Material's shapes
  (soft burst, 9-sided cookie, pentagon, pill, sunny, 4-sided cookie, oval) every
  650 ms on a spring of 200 / 0.6, turning a quarter each time, while the whole turns
  once in 4666 ms. The shapes are built from their definitions in `MaterialShapes.kt`
  (`ui.js`, `loadingShapes`).

## 5. Type and symbols

- **Google Sans Flex**, the face Material 3 Expressive is drawn in (open, from Google
  Fonts; `--font`), on the type scale (`TypeScaleTokens`), with its tracking. The large
  styles (display, headline, title-large, and the words of a 56 button or an extended
  FAB) are the **brand** face: the same font with its terminals rounded (its `ROND`
  axis at 100), which is the roundness the shapes have. Body and labels are plain.
  Code is Google Sans Code (`--mono`, `NT.look.codeFont`).

  | Style | Size / line | Weight | Tracking | Used for |
  | --- | --- | --- | --- | --- |
  | display-large | 57 / 64 | 500 | -0.25 | the lead card's title from 840 wide |
  | display-small | 36 / 44 | 500 | 0 | a place's large title; the lead card's title, narrow |
  | headline-medium | 28 / 36 | 500 | 0 | the name a page is about; a figure on a profile |
  | headline-small | 24 / 32 | 400 | 0 | a dialog's headline; a 96 button |
  | title-large | 22 / 28 | 400; 500 for a section | 0 | the bar's title, section headings, the medium extended FAB's words |
  | title-medium | 16 / 24 | 500; 700 emphasized | 0.15 | 56 buttons; emphasized: a card's title, a filled 56 button, the small extended FAB's words |
  | body-large | 16 / 24 | 400 | 0.5 | list items, fields, menus |
  | body-medium | 14 / 20 | 400 | 0.25 | supporting text, dialogs, snackbars |
  | label-large | 14 / 20 | 500; 700 emphasized | 0.1 | buttons; emphasized: a filled button, the line over the lead card's title |
  | label-medium | 12 / 16 | 500; 700 emphasized | 0.5 | navigation (emphasized where you are), a badge (emphasized) |
  | label-small | 11 / 16 | 500 | 0.5 | a list item's trailing text |

- **Emphasized styles are for what matters or is chosen**, beside the baseline ones,
  not instead of them: display, headline, title-large and body at 500, the smaller
  titles and the labels at 700 (the emphasized set of `TypeScaleTokens`). A primary
  action's label, a card's name, the place you are in.
- Symbols are Material Symbols Rounded, by name (`M.icon`), 24, 20 in a 40 button and
  in menus; filled for what is chosen or on. They stay hidden until the font has
  loaded, and if it never does the app's own drawings stand in.

## 6. Components

Use the component Material has for the job (`ui.js`):

| For | Component | Measures (token) |
| --- | --- | --- |
| The main action of a region | Filled button; tonal beside it; text in dialogs. Elevated only where a button must be parted from a busy background, which nothing here is | 40 high, 16 at either end, 8 to a 20 symbol (`ButtonSmallTokens`) |
| The action a screen leads with | The same at 56; at 96 where the screen is for nothing else | 24 at either end, a 24 symbol (`ButtonMediumTokens`); 48 at either end, 12 to a 32 symbol (`ButtonLargeTokens`) |
| A small action in a dense row | The same at 32 | 12 at either end, 4 to a 20 symbol (`ButtonXSmallTokens`) |
| An action that is a symbol | Icon button: standard; tonal or filled to stand out | a 40 container in a 48 target (`SmallIconButtonTokens`) |
| On or off | Switch (`M.switch`) | 52 × 32 track, 2 outline; handle 16, 24 on, 28 pressed, a 16 check; a 40 state layer (`SwitchTokens`) |
| On or off, once its form is sent | Checkbox (`M.check`) | an 18 container, 2 corner, 2 outline in on surface variant; primary with the check in on primary once chosen; a 40 state layer; the check a 2 stroke with square ends, drawn on, and gone 100 ms into the box emptying (`CheckboxTokens`, `Checkbox.kt`) |
| One of a few, all in view | Connected button group (`M.group`) | 40 high, 2 apart (`ConnectedButtonGroupSmallTokens`); it does not widen on a press, only a standard group does |
| One of many | A menu from the item's value (`pickItem`) | |
| A number in a range | Slider (`M.slider`) | 16 track, 4 × 44 handle with 6 either side, 2 while held, a 4 stop at the end (`SliderTokens`) |
| Typing | Outlined text field (`M.field`); a search bar for searching | 56 high; the search bar round (`OutlinedTextFieldTokens`, `SearchBarTokens`) |
| Things to open | Cards in a grid or a row; list items for dense runs | a card 28 with 8 around its picture (20), its name title-medium emphasized, a badge on the picture the bright surface and round; list item 56 for one line, 16 at either end, items 2 apart (`ListTokens`) |
| The page's one action | FAB, in the primary colour style; extended with its words | 80, the 20 corner, a 28 symbol; from 840 wide 96, the 28 corner, a 36 symbol (`FabPrimaryTokens`, `FabMediumTokens`, `FabLargeTokens`). Extended: 56, the 16 corner, 16 at either end, 8 to the words in title-medium emphasized; from 840 wide 80, the 20 corner, 26 at either end, 12 to a 28 symbol, title-large (`ExtendedFabSmallTokens`, `ExtendedFabMediumTokens`) |
| Nothing to show | An empty state (`pages.js`, `empty`) | its symbol, 32, in a round 72 of the secondary container; the title title-large |
| More than one such action | FAB menu | items 56 high, round, 24 at either end, 4 apart, 8 above the close button, which is 56, round, primary, a 20 symbol (`FabMenuBaselineTokens`) |
| Choices from a control | Menu (`M.menu`) | groups 2 apart instead of dividers, each a 16 container with 4 around; items 44 high, 12 at either end, a 20 symbol; the chosen one tertiary container (`SegmentedMenuTokens`, `StandardMenuTokens`) |
| A question | Dialog | 28 corner, 24 around, a 24 symbol in secondary (`DialogTokens`) |
| A panel from the bottom | Bottom sheet | 28 top corners, a 32 × 4 handle (`SheetBottomTokens`) |
| What just happened | Snackbar | 48 for one line, 4 corner, inverse surface (`SnackbarTokens`); with an action (Undo, Try Again, Sign In) a text button in inverse primary at the trailing end, 6 above and below, 8 from the edge and from the words (`Snackbar.kt`) |
| The service did not answer as the app started | An empty state in place of the pages, with Try Again (`app.js`, `.m-down`) | |
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
    `ProgressIndicatorTokens`, `MotionTokens`, `FilterChipTokens`, and (read
    2026-11-14) `CheckboxTokens`.
  - the components, for behaviour: `Button.kt`, `IconButton.kt`, `ToggleButton.kt`,
    `ButtonGroup.kt`, `FloatingActionButtonMenu.kt`, `ListItem.kt`, `Menu.kt`,
    `Switch.kt`, `NavigationItem.kt`, `LoadingIndicator.kt`, `MaterialShapes.kt`,
    `internal/AnimatedShape.kt`, `ProgressIndicator.kt`, `Chip.kt`, `Checkbox.kt`.
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
- [Material Design 3](https://m3.material.io/), read on 2026-11-26 (its pages are drawn
  by script: they are read as a browser draws them, the checks' own will do). What
  Expressive is, and how the parts are meant to be used:
  - *Start building with Material 3 Expressive* (`/blog/building-with-m3-expressive`):
    the seven expressive tactics, and hero moments (one or two in a product). Its
    pictures of the components in motion, and the example app of the next page, are
    what this style is held against for colour and quiet: one family of hue, soft
    containers, a deep primary, and a single small accent at most.
  - Foundations, Usability (`/foundations/usability/overview`,
    `/applying-m-3-expressive`): emphasis by colour, containment, shape, size and type;
    one primary goal a screen; like shapes kept uniform.
  - Styles, Shape (`/styles/shape/overview-principles`, `/corner-radius-scale`,
    `/shape-morph`): the ten-step corner scale with 20, 32 and 48; round beside square;
    the inner radius is the outer less the padding; the shape library for pictures and
    decoration, sparingly.
  - Styles, Typography (`/styles/typography/overview`, `/applying-type`,
    `/type-scale-tokens`, `/editorial-treatments`): the emphasized styles and where
    they go; brand and plain typefaces; editorial treatments.
  - Styles, Color (`/styles/color/roles`, `/choosing-a-scheme`): what primary,
    secondary and tertiary are for.
  - Styles, Motion (`/styles/motion/overview/how-it-works`, `/specs`): the two kinds of
    spring and their three speeds.
  - Components, specs and guidelines: buttons (five sizes, round and square, toggles),
    FAB and extended FAB (sizes by window, the six colour styles, the small and surface
    ones no longer recommended), FAB menu, button groups, icon buttons, app bars,
    toolbars, navigation bar, navigation rail, lists, cards, search, loading indicator.
- Compose's token files again, read on 2026-11-26, for the sizes those pages give only
  as pictures: `ButtonXSmallTokens`, `ButtonLargeTokens`, `ButtonXLargeTokens`,
  `FabMediumTokens`, `FabLargeTokens`, `FabPrimaryTokens`, `ExtendedFabMediumTokens`,
  `AppBarMediumFlexibleTokens`, `IconButtonMediumTokens`, `TypefaceTokens`, and
  `MaterialShapes.kt` for the loading indicator's shapes; and `Button.kt`,
  `IconButton.kt`, `ToggleButton.kt`, `ButtonGroup.kt`, `Slider.kt` for which
  spring each uses (a button's press is on the effects spring on purpose, a toggle and
  a standard group on the fast spatial one, a slider on none).
- [Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
  0.4.0 (Apache 2.0), `dynamiccolor/color_spec_2025`, the Tonal Spot variant: the scheme
  (`tools/md3-colors.js`).
- [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex) and
  [Google Sans Code](https://fonts.google.com/specimen/Google+Sans+Code), from Google
  Fonts under the Open Font License.
