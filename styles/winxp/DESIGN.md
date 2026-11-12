# Windows XP: design rules

This style is judged as a Windows XP application in the Luna theme, side by side with
the real thing. Where Microsoft's *Windows XP Visual Guidelines* and the
user experience guidelines of the time say something, that wins; the sources are at
the end. Each rule names the code that carries it (in this folder unless it says
`js/`). The rules every style shares are in [/DESIGN.md](../../DESIGN.md); these are
on top of them.

## 1. The desktop

- The desktop has one of the pictures XP came with, stretched over the screen as XP
  stretched them: Bliss, until another is chosen in Settings, Appearance
  (`wallpapers/`, `--wallpaper`); with none it is XP's plain blue (`--desktop`). On it
  are the places as 32-pixel icons with white shadowed labels. One click chooses an icon (its label
  takes the highlight, its picture is washed with it); two open it. A finger's one
  tap, or Enter, opens it (`app.js`, `desktop`).
- The **taskbar** is Luna's: 30 pixels, the green **start** button with the flag at
  its leading end, a button a window with its icon and name (the one in front pressed
  in; pressing it again puts its window away), and the clock in the lighter tray
  (`app.js`, `taskbar`).
- The **Start menu** is XP's size, 380 by 478, less on a shorter screen. Who is signed
  in is across the top with their picture, then the orange line. On the white side the
  places and New Script are pinned, in bold; under the rule are the scripts worked on
  last, as many as there is room for, and at its foot All Scripts with the green arrow.
  On the pale blue side are the person's own lists, in bold, then Profile and the
  settings. The way in or out is along the bottom (`app.js`, `taskbar`).

## 2. A window

Top to bottom (`ui.js`, `W.window`):

| Part | For |
| --- | --- |
| Title bar | The icon, the name in bold Trebuchet, Minimize, Maximize, Close. It moves the window. |
| Menu bar | **Everything** that can be done in the window. File first; it ends with Close. |
| Toolbar | What is done most: flat buttons with a picture, raised under the pointer (`W.tool`). |
| Address bar | In a window that shows a place: where it is; its list is the places (`win.setAddress`). |
| Client area | The content. |
| Status bar | What the window has to say: a count, the save state, what just happened. |

- A window that shows a place (Home, Scripts, Maps) is an **Explorer window**
  (`pages.js`, `placeBars`): Back and Forward go through where the browser has been
  and are grey when there is nowhere to go, Up goes to Home, Search is on the toolbar
  where there is something to search, and the flag sits at the end of the menu bar.
- Such a window has the **task pane** down its left (`W.tasks`): what can be done
  here, which follows what is chosen; Other Places; Details of what is chosen. A
  group's title folds it away. **Search** swaps the groups for the field that asks
  what to look for, as Explorer's does, and puts them back when it is turned off.
- The task pane is a second way to the commonest actions. The **menu bar still holds
  everything**; on a small screen the pane is gone and the menus remain (while
  searching, the field is a strip across the top).
- Windows that are about one thing (a script, settings) are tabbed property sheets on
  the face colour, with no toolbar and no pane.
- Any edge or corner of its frame sizes a window; the grip in the status bar is the
  lower right corner (`ui.js`, `size`; `.w-size`).
- What a toast says elsewhere is said in the status bar of the window in front
  (`UI.toast`). Only a warning with no window to say it in is a message box.
- A dialog box is modal, has Close alone in its title bar, and its buttons along the
  bottom. A message box has XP's icon for what it is and its buttons centred.

## 3. The look

- **Luna follows the accent and the theme, whole.** The frame, title bar, taskbar,
  Start menu, task pane, scroll bars and the blue edges of controls are written as
  Luna's blue scheme has them, colour by colour, and each is drawn from that
  (`--luna-…`, and the tokens in `style.css` that begin `oklch(from #…`): the accent
  turns its hue (`--H`) and keeps as much of the colour as that hue can carry (`--C`),
  and the dark theme lowers the frame and bars to near black in the same hue (`--L`), as
  Royale Noir lowered them. Blue turns nothing: it is Luna as XP has it. Luna's bitmaps
  (`icons/cap-*`, `sb-*`, `combo*`, `pane-up`) are turned the same way by a filter.
  Close stays red and the start button green, as in every scheme XP has. A window has
  no shadow; a menu has a small hard one.
- A colour of Luna is never written into a rule as it is: it is given a token beside
  the others, so it follows too.
- The accent is also XP's *Selected Items* colour (`--hilight`): what is chosen in a
  list, a tree or a menu, the open menu's name, selected text. Blue's is Luna's own
  `#316AC5`.
- The face is beige (`--face`); fields, lists and the content of a place are white
  with a thin blue-grey edge (`--field-edge`). No bevels.
- Push buttons are 75 by 23 at least, with a dark blue edge and three-pixel corners.
  Under the pointer they **glow orange**; the default one and the one with the
  keyboard glow blue, and the keyboard's has the dotted rectangle inside it. The same
  orange tops the chosen tab and underlines the column header under the pointer.
- A check mark and a chosen option are green. Scroll bars are Luna's pale blue thumb
  with its grip and an arrow at each end, in the page and in Monaco alike.
- Tahoma 11 px for everything (`--font`, `--fs`); the title bar is Trebuchet MS bold
  13 px; **start** and the name across the top of the Start menu are Franklin Gothic
  Medium, which has an italic and no bold, so it is never asked for bold. Group titles are blue; section headings in a place are bold over a line that
  fades out. Code is in Lucida Console.
- **Icons are Windows XP's own** (`icons.js`, `icons/`): `W.icon(name, size)` gives
  the picture drawn for that size (16, 24, 32, 48) and for the screen's scaling, so
  nothing is stretched from a smaller one. None is drawn for this app.
- Colours come from the tokens at the top of `style.css`. The dark theme is not XP's:
  it keeps every rule here, makes the faces dark and lowers Luna and the desktop's
  picture, by tokens only.

## 4. Motion

None (`NT.look.still`). A window, a menu or a page of tabs is there or it is not.

## 5. Touch

Where the pointer is a finger, sizes grow (`@media (any-pointer: coarse)` in
`style.css`: the font, rows, buttons, boxes) and nothing else changes. On a small
screen a window is the whole screen and cannot be moved or sized.

## Sources

- *Windows XP Visual Guidelines* (Microsoft, 2001): Luna, icons, the task pane.
- *Official Guidelines for User Interface Developers and Designers* (Microsoft, the
  XP-era edition): windows, menus, controls, dialog boxes.
- Windows XP itself, as the reference for metrics and colour.
- Pictures, all Microsoft's artwork from Windows XP, taken from:
  - [B00merang-Artwork/LinXP](https://github.com/B00merang-Artwork/LinXP)
    (`icon-build/`): the icons at 16, 24, 32 and 48 pixels (`icons/<name>-<size>.png`).
  - [ShizukuIchi/winXP](https://github.com/ShizukuIchi/winXP)
    (`src/assets/windowsIcons/`, MIT): the Explorer toolbar's Back, Forward, Up and
    Search, the open folder, the flag, the task pane's chevron and the Start menu's
    default picture; and the measured gradients of the title bar, taskbar, tray and
    Start menu.
  - [XP.css](https://github.com/botoxparty/XP.css) (MIT): pixel tracings of Luna's
    caption buttons, scroll bar, drop-down button, trackbar thumb, check mark and
    option dot, drawn here as PNG at three times their size; and the measured colours
    of buttons, tabs, fields and group boxes.
  - The Start menu's green arrow (`icons/all.png`) is from ShizukuIchi/winXP, at three
    times its size; Favorites (`icons/star-*`) is from LinXP.
  - The wallpapers (`wallpapers/`) are the twenty XP came with, as they are on the
    Windows XP CD (800 by 600). Bliss alone is from Microsoft's own later release of it
    at 1920 by 1080, made a JPEG.
