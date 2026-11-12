# Windows 95: design rules

This style is judged as a Windows 95 application. Where *The Windows Interface
Guidelines for Software Design* says something, that wins; the sources are at the
end. Each rule names the code that carries it (in this folder unless it says `js/`).
The rules every style shares are in [/DESIGN.md](../../DESIGN.md); these are on top
of them.

## 1. The desktop

- Every address is a window on the desktop (`app.js`, `NT.nav`). Going somewhere opens
  its window or brings it to the front; closing a window is going back.
- The taskbar has the Start button, one button a window, and the clock. The window in
  front is the pressed button.
- The Start menu and the desktop icons are the places: Home, Scripts, Maps, Profile,
  Settings. An icon opens on a double click; a finger's one tap, or Enter, opens it.
- The desktop is its plain colour unless a wallpaper is chosen (Settings, Appearance):
  Windows 95's own, the small ones tiled from the corner and Clouds over the whole
  screen (`wallpapers/`, `--wallpaper`). Over one, an icon's name stands on the
  desktop's colour.
- On a small screen a window is the whole screen and cannot be moved or sized.

## 2. A window

Top to bottom (`ui.js`, `W.window`):

| Part | For |
| --- | --- |
| Title bar | The icon, the name, Minimize, Maximize, Close. It moves the window. |
| Menu bar | **Everything** that can be done in the window. File first; it ends with Close. |
| Toolbar | What is done most, as buttons with words on them. |
| Client area | The content. |
| Status bar | What the window has to say: a count, the save state, what just happened. |

- Any edge or corner of its frame sizes a window; the grip in the status bar is the
  lower right corner (`ui.js`, `size`; `.w-size`).
- An action is in the menu bar whether or not it is anywhere else. The right mouse
  button's menu on a thing is the same items, never the only place for one.
- A menu item that cannot be used now is greyed, not left out. One that opens a dialog
  ends in an ellipsis.
- What a toast says in other styles is said in the status bar of the window in front
  (`UI.toast`). Only a warning with no window to say it in is a message box.
- Waiting is the hourglass over the window (`win.busy`), and the list stays as it was.

## 3. Dialog boxes

- A question, or something that must be answered before going on, is a dialog box
  (`W.dialog`, `W.message`): centred, modal, with no Minimize or Maximize.
- Buttons are along the bottom, right-aligned: the default one first, Cancel last.
  Enter presses the default button (the one with the dark border); Escape cancels.
- A message box has the icon for what it is: a question, a warning, an error, a note.
- Settings that go together are pages of one tabbed dialog, not a stack of windows.

## 4. Controls

Use the control the system has for the job (`ui.js`):

| For | Control |
| --- | --- |
| Doing something | Push button (`W.button`) |
| On or off | Check box (`W.check`), never a switch |
| One of a few | Option buttons (`W.radios`); a drop-down list (`W.combo`) when there are many |
| A number in a range | Trackbar (`W.trackbar`) with its value beside it |
| Views of one thing | Tabs (`W.tabs`) |
| Related controls | Group box (`W.group`) |
| Many things with facts about them | List view in columns (`W.list`); a column header sorts by it |
| Files in folders | Tree view (`js/explorer.js`, drawn here) |

- In a list, one click chooses; a double click or Enter opens; the toolbar and the File
  menu act on what is chosen.
- Text in a field can be selected; nothing else can.

## 5. The look

- Faces are grey with a two-pixel bevel lit from the upper left. Buttons, title-bar
  buttons and scroll bars are raised (`--bi-raised`); fields and lists are sunken into
  the face and white (`--bi-sunken`); a pressed button is the raised bevel turned over
  (`--bi-pressed`); a window and a menu have the frame (`--bi-frame`).
- A bevel is a **border with a picture of its lines in it** (`border-image`), never an
  inset shadow. A border is put on whole screen pixels at any scaling and a shadow is
  not: at 150 % shadows gave every bevel a different thickness. A part with one line
  has a plain one-pixel border (`--line-in`, `--line-out`).
- No rounded corners, no shadows, no gradients, no transparency.
- The highlight colour marks the title bar of the window in front and whatever is
  chosen. It is the accent (`--sel`); a window that is not in front has a grey title.
- One font at one size for everything (`--font`, `--fs`): MS Sans Serif at 8 points,
  11 pixels, plain and bold. A browser cannot be given Windows' own, which is a font of
  pixels, so it is here as a font drawn from those pixels (`fonts/`); nothing is set in
  another face or made bold by smearing. Bold is for title bars and the name of the
  thing a window is about. Code is in Courier New.
- Focus is a dotted rectangle inside the control.
- Icons are **Windows 95's own**, 16 × 16 and 32 × 32 in its sixteen colours
  (`icons/`, named in `icons.js` by what each is for here). Nothing is drawn to stand
  in for one: a new need is met from the system's set. At a whole multiple of their
  size they keep their pixels; in between they are smoothed (`img.pix`).
- The Start button has the Windows flag. A dialog box has no icon in its title bar.
- A menu bar name is plain until its menu is open; then it is the highlight colour.
- Colours come from the tokens at the top of `style.css`: `--face`, `--hilight`,
  `--light`, `--shadow`, `--dark`, `--window`, `--text`, `--gray-text`, `--sel`.
- The dark theme is not Windows 95's. It keeps every rule here and makes the faces
  dark; it changes tokens only.

## 6. Motion

A window, a menu or a page of tabs is there or it is not (`NT.look.still`), with one
exception. The Start menu comes up out of the taskbar, top first (`W.menu`, `rise`): not
as Windows 95 first shipped, where it only appeared, but as it did with the shell that
Internet Explorer 4 gave Windows 95, and in Windows 98. It moves in steps that land on
whole screen pixels, and shuts at once.

## 7. Touch

Windows 95 had no touch screens. Where the pointer is a finger, sizes grow
(`@media (any-pointer: coarse)` in `style.css`: the font, rows, buttons, the title bar)
and nothing else changes.

## Sources

- *The Windows Interface Guidelines for Software Design* (Microsoft Press, 1995):
  windows, menus, dialog boxes, the common controls, visual design.
- Windows 95 itself, as the reference for the bevels, the metrics and the sixteen
  system colours.
- The icons are Microsoft's, from Windows 95, as extracted in the
  [React95 icon set](https://github.com/React95/React95) (`@react95/icons` 2.11.0).
- The wallpapers are Microsoft's, from the Windows 95 CD, turned from BMP into PNG
  without loss and named as its setup names them.
- The font is the one drawn from MS Sans Serif's pixels for
  [98.css](https://github.com/jdan/98.css) (MIT), `fonts/converted/`.
