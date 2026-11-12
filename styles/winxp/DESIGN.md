# Windows XP: design rules

This style is judged as a Windows XP application in the Luna theme. Where Microsoft's
*Windows XP Visual Guidelines* and the user experience guidelines of the time say
something, that wins; the sources are at the end. Each rule names the code that
carries it (in this folder unless it says `js/`). The rules every style shares are in
[/DESIGN.md](../../DESIGN.md); these are on top of them.

It began as a copy of the Windows 95 style and keeps what XP kept: every address is a
window, the menu bar holds everything, dialogs are modal, a list is a list view. What
follows is where XP differs.

## 1. The desktop

- The taskbar is the accent colour with the **green Start button** at its leading
  end, a button a window, and the clock in a lighter tray (`app.js`).
- The **Start menu has two sides** under the name of whoever is signed in: what the
  app is for on the white side (Home, Scripts, Maps, New Script), the person's own
  places on the blue side (Profile, Settings), and the way in or out along the bottom.

## 2. A window

- A window that shows a place (Home, Scripts, Maps) has the **task pane** down its left
  (`ui.js`, `W.tasks`): a group of what can be done here, which follows what is
  chosen; Other Places; and Details of what is chosen. A group's title folds it away.
- The task pane is a second way to the commonest actions. The **menu bar still holds
  everything**; on a small screen the pane is gone and the menus remain.
- Windows that are about one thing (a script, settings) are tabbed, with no task pane.
- What a toast says elsewhere is said in the status bar of the window in front.

## 3. The look

- Title bars are the accent with a light along the top and a shade along the bottom,
  rounded at the top corners, with white bold Trebuchet; the window's frame is the same
  colour. A window that is not in front is the same, washed out.
- Caption buttons are small rounded squares in the title colour; Close is red.
- The face is beige (`--face`); fields, lists and the content of a place are white
  with a thin blue-grey edge (`--field-edge`). No two-pixel bevels.
- Buttons are soft: a pale gradient, a dark edge, three-pixel corners. Under the
  pointer they **glow orange** (`--hot`); the default one glows blue. The same orange
  marks the tab that is chosen and the column header under the pointer.
- A check mark and a chosen option are green (`--go`), like the Start button.
- Menus are white with a thin edge and a soft shadow; what is pointed at is the
  accent with white text.
- Tahoma at one size (`--font`, `--fs`). Group titles and section labels are blue.
- Icons are soft, lit from above, drawn for this app (`icons.js`). None is copied
  from Windows.
- Colours come from the tokens at the top of `style.css`. The dark theme is not
  XP's: it keeps every rule here and makes the faces dark, by tokens only.

## 4. Motion

None (`NT.look.still`), as in Windows 95.

## Sources

- *Windows XP Visual Guidelines* (Microsoft, 2001): Luna, icons, the task pane.
- *Official Guidelines for User Interface Developers and Designers* (Microsoft, the
  XP-era edition): windows, menus, controls, dialog boxes.
- Windows XP itself, as the reference for metrics and colour.
