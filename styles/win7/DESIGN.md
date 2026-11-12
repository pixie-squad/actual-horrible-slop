# Windows 7: design rules

This style is judged as a Windows 7 application under Aero. Where the *Windows User
Experience Interaction Guidelines* say something, that wins; the sources are at the
end. Each rule names the code that carries it (in this folder unless it says `js/`).
The rules every style shares are in [/DESIGN.md](../../DESIGN.md); these are on top
of them.

It began as a copy of the Windows XP style and keeps what 7 kept: every address is a
window, dialogs are modal, a list is a list view, the same controls for the same jobs.
What follows is where 7 differs.

## 1. The desktop

- The taskbar is **glass**. The Start button is a round one at its leading end; then
  **an icon a window**, with no words (the window's name is its tooltip); the time
  over the date; and at the far end the sliver that puts every window away to show
  the desktop (`app.js`).
- The Start menu has what the app is for on its white side, and on its glass side who
  is signed in, their own places, and the way in or out at the bottom.

## 2. A window

Top to bottom (`ui.js`, `W.window`):

| Part | For |
| --- | --- |
| Title bar | Glass. The caption buttons hang from its top edge, joined; Close is the wide red one. |
| Address row | In a window that shows a place: where it is, as a trail from Home, and the search field. Such a window has no title text; the trail says it. |
| Command bar | **Everything** that can be done: Organize (and the other menus) as buttons that drop down, then what is done most, as words. There is no menu bar. |
| Navigation pane | In a window that shows a place: the places, the one shown marked (`W.places`). |
| Client area | The content. |
| Details pane | In such a window: what is chosen, its picture and facts (`W.details`). |
| Status bar | What the window has to say for a moment. |

- An action is in the command bar's menus whether or not it also has a button there.
  Buttons that need something chosen are greyed until something is.
- Windows that are about one thing (a script, settings) are tabbed and have a title,
  with no address row and no panes.

## 3. Dialog boxes

- What is being asked is the **main instruction**: first, larger, in the heading
  colour, with the icon beside it. Anything more is plain text under it.
- The buttons are on a grey strip along the bottom, right-aligned, the one that goes
  on first and Cancel last.

## 4. The look

- **Glass** is for the frame of a window, the taskbar and the Start menu, and nothing
  inside a window (`--glass`, `--glass-blur`). It is the accent, thinned, over a blur
  of what is behind. A window that is not in front loses the tint.
- Inside, surfaces are white (`--window`) or light grey (`--face`), parted by thin
  lines (`--edge`). No bevels.
- Controls are flat with a soft two-step gradient and a thin edge. Under the pointer
  they turn **pale blue** (`--hot`); pressed, deeper (`--down`).
- What is chosen in a list, a tree or a menu is a pale wash of the accent with a
  thin edge and rounded corners, across the whole row (`--pick`). Text stays dark.
- Headings (a main instruction, a section's label, the name a window is about) are
  in the heading colour, a size up, not bold.
- Segoe UI throughout (`--font`); code is in Consolas.
- Icons are soft, lit from above, drawn for this app (`icons.js`). None is copied
  from Windows.
- Colours come from the tokens at the top of `style.css`. The dark theme is not 7's:
  it keeps every rule here and makes the surfaces dark, by tokens only.

## 5. Motion

- A window and a menu fade in as they open (`w-open`, `w-fade`). Nothing else moves
  (`NT.look.still`).

## Sources

- *Windows User Experience Interaction Guidelines* for Windows 7 and Windows Vista
  (Microsoft, 2010): windows, the command bar, dialog boxes and main instructions,
  controls, Aero aesthetics.
- Windows 7 itself, as the reference for metrics and colour.
