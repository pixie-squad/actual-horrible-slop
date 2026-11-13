# Design rules

The app has more than one look. Each is a **style**: its own shell and its own pages
in `styles/<id>/`, on the core in `js/`. A style is judged as an app of the platform
it takes after, and its own rules, with their sources, are in
`styles/<id>/DESIGN.md`. The rules here hold in every style.

| Style | Folder | Rules |
| --- | --- | --- |
| Liquid Glass (default) | `styles/glass/` | [styles/glass/DESIGN.md](styles/glass/DESIGN.md) |
| Material 3 Expressive | `styles/md3/` | [styles/md3/DESIGN.md](styles/md3/DESIGN.md) |
| Material Design 2 | `styles/md2/` | [styles/md2/DESIGN.md](styles/md2/DESIGN.md) |
| Windows 95 | `styles/win95/` | [styles/win95/DESIGN.md](styles/win95/DESIGN.md) |
| Windows XP | `styles/winxp/` | [styles/winxp/DESIGN.md](styles/winxp/DESIGN.md) |
| Windows 7 | `styles/win7/` | [styles/win7/DESIGN.md](styles/win7/DESIGN.md) |

## 1. Styles

- A style is built from its platform's own parts, the way that platform builds an
  app. It is not another style with different colours: nothing of one style's look or
  layout is carried into another.
- What is the same everywhere is the core: the service (`js/api.js`), addresses
  (`js/routes.js`), the editing session (`js/session.js`), the editor engine
  (`js/monaco.js`), the explorer (`js/explorer.js`), images (`js/media.js`), test runs
  (`js/tests.js`). What the app *does* changes there, once. How it *looks* changes in one style.
- No file in `js/` knows which style is on. It asks the style through what the style
  provides (`NT.ui`, `NT.nav`, `NT.look`; the list is in `js/styles.js`).
- Every style has a page for every address (`NT.routes`), and the control that
  changes the style in its settings.
- The explorer and Monaco are shared. A style draws them with its own CSS, by their
  class names, and gives Monaco its colours through its tokens.
- A test run is words: its heading, what the script printed, and the battle as a
  table (`NT.tests.state`). The core says what each of them reads; a style draws them
  with its own heading, list and table.

## 2. Behaviour

- An action never navigates as a side effect.
- Defaults are the quiet state: closed, collapsed, unselected.
- What can be done can be seen. An action behind a gesture only (right-click, press
  and hold) also has a visible control.
- Content that has not arrived is shown as its own layout with the words and artwork
  left out, or as the platform shows waiting. Never a blank block, and nothing jumps
  when the content comes.
- Where a style animates, the animation is right in every frame, not only once it has
  settled.

## 3. Colour and type

- Colours come from the style's tokens, by meaning. Never a raw value in a component.
- Every style has a light and a dark theme, and takes the accent.
- A colour means one thing.

## 4. Copy

- Terse. No explanatory footers, no implementation notes, nothing about features that
  are not there.
- If the screen tells someone to do something, the control for it is on that screen.
- The words are the same in every style; a platform's own names for its parts
  (OK, Cancel, Properties) are that style's.

## 5. Before calling a change done

- Both themes.
- At 1280 px wide with 150 % scaling, and at phone width.
- Hover, press, keyboard focus and open-menu states, not only rest.
- A frame from the middle of each animation it touches.
- Frame cost on real interactions (scrolling, changing page, opening a menu),
  measured, not judged from screenshots.
- A change in `js/` is checked in every style.
