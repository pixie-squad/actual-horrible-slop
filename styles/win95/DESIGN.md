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
  buttons and scroll bars are raised (`--raised`); fields and lists are sunken into the
  face and white (`--sunken`); a pressed button is the raised bevel turned over.
- No rounded corners, no shadows, no gradients, no transparency.
- The highlight colour marks the title bar of the window in front and whatever is
  chosen. It is the accent (`--sel`); a window that is not in front has a grey title.
- One font at one size for everything (`--font`, `--fs`); bold for title bars and the
  name of the thing a window is about. Code is in Courier New.
- Focus is a dotted rectangle inside the control.
- Icons are 16 × 16 or 32 × 32 pictures in the sixteen system colours, drawn for this
  app (`icons.js`). None is copied from Windows.
- Colours come from the tokens at the top of `style.css`: `--face`, `--hilight`,
  `--light`, `--shadow`, `--dark`, `--window`, `--text`, `--gray-text`, `--sel`.
- The dark theme is not Windows 95's. It keeps every rule here and makes the faces
  dark; it changes tokens only.

## 6. Motion

There is none (`NT.look.still`). A window, a menu or a page of tabs is there or it is
not.

## 7. Touch

Windows 95 had no touch screens. Where the pointer is a finger, sizes grow
(`@media (any-pointer: coarse)` in `style.css`: the font, rows, buttons, the title bar)
and nothing else changes.

## Sources

- *The Windows Interface Guidelines for Software Design* (Microsoft Press, 1995):
  windows, menus, dialog boxes, the common controls, visual design.
- Windows 95 itself, as the reference for the bevels, the metrics and the sixteen
  system colours.
