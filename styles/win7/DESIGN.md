# Windows 7: design rules

This style is judged as a Windows 7 application under Aero, side by side with the real
thing. Where the *Windows User Experience Interaction Guidelines* say something, that
wins; the sources are at the end. Each rule names the code that carries it (in this
folder unless it says `js/`). The rules every style shares are in
[/DESIGN.md](../../DESIGN.md); these are on top of them.

## 1. The desktop

- Every address is a window on the desktop (`app.js`, `NT.nav`). Going somewhere opens
  its window or brings it to the front; closing a window is going back.
- The **taskbar** is glass (`app.js`, `taskbar`). From its leading end: the Start orb;
  the places pinned to it (Home, Scripts, Maps), there whether or not their window is
  open; a button for every other window; the notification area with the app's own
  icon; the time over the date; the sliver that puts every window away and brings
  them back.
- A taskbar button is its icon, with no words (the name is its tooltip). One with a
  window open has the glass frame; the one in front is lit; under the pointer it glows
  in the colour of its own icon, from where the pointer is (`--tint`, `--mx`). The
  button of the window in front puts that window away.
- The **Start menu** is Windows 7's size, 410 by 540, less on a shorter screen
  (`app.js`, `startMenu`). Down its white side, the wider: the places and New Script,
  pinned; under the line the scripts worked on last, as many as there is room for (one
  that does not fit is left out whole); All Scripts; the search box (Enter looks
  through Scripts). On its glass side: the picture of whoever is signed in standing out
  of the top edge, their name, their own lists, the settings, and at the foot, where
  Shut down is, the button that signs in or logs off, as wide as its words.
- The desktop has one of Windows 7's own pictures: Harmony, which it came with, until
  another is chosen from their thumbnails in Settings, Appearance: one from each of its
  themes, or none (`wallpapers/`, `--wallpaper`). With none it is the one drawn in the
  stylesheet (`--desktop`). The glass shows the picture through it.
- A desktop icon opens on a double click; a finger's one tap, or Enter, opens it.
- On a small screen a window is the whole screen and cannot be moved or sized.

## 2. A window

Top to bottom (`ui.js`, `W.window`):

| Part | For |
| --- | --- |
| Caption | Glass. The icon and the name; the caption buttons hang from its top edge as one piece, and Close is the wide red one. It moves the window; twice on it maximises. |
| Address row | In a window that shows a place, on the glass: Back and Forward, where the window is as a trail from Home, Refresh at the trail's end, and the search box. Such a window has no name in its caption; the trail says it. |
| Command bar | **Everything** that can be done: the menus (Organize in a place, File elsewhere) as buttons that drop down, then what is done most, as words. There is no menu bar. |
| Navigation pane | In a place: the places as a tree, the one shown marked (`W.tree`; `pages.js`, `places`). Mine, Favorites and All are under Scripts, and Libraries, with Explorer's own Libraries icon, where they can be looked for. A triangle opens and shuts what is under a place; the triangles show while the pointer or the keyboard is in the pane. |
| Client area | The content. |
| Details pane | In a place, instead of a status bar: what is chosen, its picture large, and facts about it with their labels greyed (`W.details`). |
| Status bar | In every other window: what it has to say, and what just happened. |

- A window that shows a place (Home, Scripts, Maps) **goes to another place in its own
  frame** and keeps its own Back and Forward (`NT.nav.travel`); Alt with an arrow does
  the same. A place that is already open elsewhere, or anything that is not a place,
  is its own window.
- An action is in the command bar's menus whether or not it also has a button there.
  Buttons that need something chosen are greyed until something is.
- Windows that are about one thing (a script, a profile, settings) are tabbed like a
  property sheet and have a name in their caption, with no address row, no panes and
  no status bar: under the tabs are its buttons, and nothing under them.
- A place that fills as it is read (Libraries) shows its list with the headings and
  nothing under them while its address bar fills with pale green from its start, as
  Explorer's does while it searches (`win.loading`); the pointer is the arrow with the
  busy circle, and the details pane has the count.
- Any edge or corner of the glass frame sizes a window (`ui.js`, `size`; `.w-size`).
  The grip is the status bar's; a window without one has none.
- What a toast says elsewhere is said in the **status bar** of the window in front.
  Where there is none (a place, a property sheet, no window) it is a **balloon** from
  the app's icon in the notification area (`UI.toast`, `W.balloon`).
- What can be acted on is never only in a status bar. Something that can be taken back
  (Undo) is a balloon: a press on it does it, and it says so as a link. A failure that
  can be tried again is a message box with the error icon, Retry and Cancel; one the
  app cannot start without (the service out of reach) has Retry alone.

## 3. Dialog boxes

- A question is a dialog box (`W.dialog`, `W.message`): centred, modal, glass with only
  Close in its caption. Escape cancels; Enter presses the default button.
- What is being asked is the **main instruction**: first, larger, in the heading
  colour, with the icon beside it. Anything more is plain text under it.
- The buttons are on the grey strip along the bottom, right-aligned, the one that goes
  on first and Cancel last. The default button has the blue glow, which breathes.
- A property sheet (Test Settings: `tests.js`, `W.testSettings`) is on the face, its
  tabs and under them OK, Cancel and Apply, with no strip (`.w-sheet`). OK and Apply
  keep what was changed, Cancel leaves it; Apply is grey until there is something to
  apply.
- A dialog that lists things to pick from (History: `editor.js`) has a list view and
  Open, the default button, grey until something is chosen; one opened from it lies
  over it.

## 4. Controls

The ones Windows 7 has, drawn as it drew them (`ui.js`; the values are measured ones,
see the sources):

| For | Control |
| --- | --- |
| Doing something | Push button: a grey split gradient with a dark edge, pale blue under the pointer, deeper blue pressed (`W.button`) |
| On or off | Check box (`W.check`), never a switch |
| One of a few | Option buttons (`W.radios`); a drop-down list (`W.combo`) when there are many |
| A number in a range | Trackbar with the pointed thumb (`W.trackbar`) |
| Typing | Edit field with the edge that is darker along its top (`W.input`); a search box with the magnifying glass (`W.search`) |
| A line to copy | A read-only field, on the face as Windows 7 colours one, and Copy beside it (`pages.js`, `copyLine`) |
| Views of one thing | Tabs (`W.tabs`) |
| Related controls | Group box (`W.group`) |
| Many things with facts about them | List view in columns (`W.list`): a heading sorts by its column, and the mark of which way sits over the heading's middle |
| Files in folders | Tree view (`js/explorer.js`, drawn here) |
| How far along | Progress bar: the glossy green in the grey well, or its marquee when there is no telling (`tests.js`) |

- What is under the pointer in a list, a tree or a menu has the pale blue wash with a
  thin rounded edge (`--hot`); what is chosen has the deeper one (`--pick`), and the
  grey one while the keyboard is somewhere else (`--pick-off`). Text keeps its colour.
- A menu is grey with the gutter down its left for marks (`W.menu`).
- Keyboard focus is a dotted rectangle inside the control.

## 5. The look

- **Glass** is for a window's frame, the taskbar and the Start menu, and nothing
  inside a window. It is the accent, thinned, over a blur of what is behind
  (`--glass`, `--glass-blur`), with a dark outer edge, a bright inner one, the two
  bright top corners and the **streaks of light, which stay where they are on the
  screen** while the glass moves over them (`--glass-streaks`, placed by `--wx` and
  `--wy`, which a window is given as it moves). A window that is not in front is
  paler, its shadow smaller and its caption buttons colourless.
- The accent is the colour of the glass (`--glass-rgb`); blue is Windows 7's own Sky.
  What is chosen stays Windows 7's blue whatever the glass is.
- Settings, Appearance has Windows 7's own **Enable transparency**. Off, the frames
  are opaque (`html[data-solid]`). Glass is not switched off by itself when the
  system asks for less transparency.
- Inside, surfaces are white (`--window`) or light grey (`--face`), parted by thin
  lines. The command bar and the details pane are the pale blue-white of Explorer's.
- Headings (a main instruction, the name a window is about) are in the heading colour,
  larger, not bold; a heading over a group in a place is navy with a line running out
  to its right (`.w-label`).
- Segoe UI at 9 pt throughout (`--font`, `--fs`); the caption's text is dark with the
  white glow behind it. Code is in Consolas; what an `#if` leaves out of it is in the
  grey of text that cannot be used (`.nt-inactive`).
- **Icons are Windows 7's own** (`icons.js`, `icons/`), kept at each size they are
  shown at and at one and a half and twice that, so they are sharp at 100 %, 150 % and
  200 % scaling. So are the Start orb, Back and Forward. The table in `icons.js` is
  the list: a picture nothing asks for is not kept.
- Under the desktop's picture, and in its place when there is none, is the desktop
  drawn in the stylesheet (`--desktop`): blue, lit, without the Windows logo.
- Colours come from the tokens at the top of `style.css`.
- Windows 7 had no dark theme. This one is Aero with the glass set dark, as Window
  Color lets it be, and inside a window the same controls drawn again for a dark
  surface. It takes after Microsoft's own dark programs of those years: Windows Media
  Player 12 and Media Center, Office 2010 in Black, Expression Blend. Its values are
  chosen here, not measured. It keeps every rule above, and where a rule names a light
  colour the dark theme has its own:
  - The glass is the accent, deep, over smoke (`--glass`, `--glass-smoke`). It takes
    less of the light: the edges, the streaks and the bevels of everything made of
    glass are one family (`--shine-*`), which the dark theme lowers. The caption's
    text is white with a dark glow behind it. A window that is not in front is greyer.
    With transparency off the frames are the same deep colour, opaque.
  - What a window shows is the darkest surface (`--window`), the face of a dialog a
    step lighter (`--face`), a button lighter than both under a black edge. A field is
    a well, its edge darkest along its top.
  - Every control is built as its light one is, with values for dark: the split
    gradient of a button with its edge and its inner highlight, the rounded washes with
    their thin edge, the gradient of the command bar and of the details pane, a groove
    as a dark line with a light one beside it (`--groove`, `--etch`), the glossy green
    in its well. Under the pointer a button is lit blue. Text stays light.
  - What is chosen is a deeper blue than the light theme's, one that white text reads
    on (`--sel`); the washes and the lit button are shades of it. The default button's
    glow is a see-through blue inside a darker blue edge. Keyboard focus is a light
    dotted rectangle (`--focus`).
  - The desktop's picture is lowered (`--wall-dim`), and the drawn desktop is a darker
    one.
  - It is done with tokens. One rule is the dark theme's alone: in Settings a colour
    is shown as the glass it makes (`.w-swatch`).

## 6. Motion

- A window opens growing a little as it fades in and closes the same way out, where it
  stood (`w-open`, `w-shut`); a menu, the Start menu and a balloon fade (`w-fade`). A
  window that takes another's place in the same frame does neither.
- A caption button's glow fades in and out; the default button's glow breathes.
- A progress bar moves as Windows 7's does: its green eases forward, the light runs
  along it, and while there is no telling how long the marquee goes along the well.
  So does the green in the address bar of a place still being read.
- Nothing else moves, and the core's own parts do not (`NT.look.still`).
- Glass costs a render pass a surface. Dragging a window, opening the Start menu and
  switching windows are measured for dropped frames whenever the glass changes.

## 7. Touch

Windows 7 had few touch screens. Where the pointer is a finger, sizes grow
(`@media (any-pointer: coarse)` in `style.css`) and nothing else changes.

## Sources

- *Windows User Experience Interaction Guidelines* for Windows 7 and Windows Vista
  (Microsoft, 2010): windows, the command bar, dialog boxes and main instructions,
  notifications, controls, Aero aesthetics.
- Windows 7 itself, as the reference for metrics, colour and behaviour.
- [7.css](https://github.com/khang-nd/7.css) (MIT), read for its measured gradients and
  metrics of the glass frame, the caption buttons and the common controls. None of its
  code is here.
- The icons, the Start orb and the Back and Forward buttons are Microsoft's, from
  Windows 7, as PNG files in the
  [B00merang-Artwork/Windows-7](https://github.com/B00merang-Artwork/Windows-7) icon
  set, scaled to the sizes used here. They are not this app's own work. Libraries
  (`icons/libs-*`) is that set's `filesystems/gnome-fs-directory-docs.png`, Windows 7's
  Libraries icon at 128 pixels, scaled down.
- The wallpapers (`wallpapers/`) are Microsoft's, from the Windows 7 DVD at 1920 by
  1200: `img0` (Harmony) and one from each theme (Nature `img3`, Landscapes `img8`,
  Architecture `img17`, Characters `img19`, Scenes `img28`), saved again as smaller
  JPEGs, each with a thumbnail.
