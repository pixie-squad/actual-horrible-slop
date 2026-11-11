# Design rules

The app is judged as an iOS app with Liquid Glass. Where Apple's Human Interface
Guidelines say something, that wins; the sources are at the end. Each rule names the
code that carries it.

## 1. Two layers

- **Glass is for controls and navigation only**: the tab bar, top buttons, menus,
  dialogs, sheets, toasts. Content (cards, lists, the editor) is opaque and scrolls
  underneath. Never put `.glass` on content.
- The one exception is a control's moving part while it is held: a switch knob, slider
  thumb or segment thumb lifts into glass (`.lens-held`) and settles back.
- Use glass sparingly. Repeated glass in content (the heart on a card) takes the light
  only, never the lens (`NT.glass.shine`, not `NT.glass.refract`).
- Nothing spans the top of the screen. The top bar is floating pieces, not a slab.

## 2. The material

| Variant | Class | Use for |
| --- | --- | --- |
| Regular | `.glass` | Bars and buttons. |
| Thick | `.glass.thick` | Surfaces that carry text: menus, dialogs, toasts. |
| Clear | `.glass.on-art` | Only over artwork, where the label is always white. |
| Tinted | `.glass.tinted` | The one primary action on a screen. |

- Glass has no colour of its own. It takes colour from what is behind it and turns
  dark with a light glyph over artwork (`NT.tone`, `Tone.mark` on the artwork).
- **One tinted control per screen, at the trailing end** (Save in the editor). Emphasis
  goes on the background, not the glyph. Everything else is monochrome.
- Never hard-code a fill on a glass variant: it must follow the Clear … Tinted
  preference (`--frost`), Reduce Transparency (`html[data-solid]`) and
  `prefers-contrast: more`.
- Refraction and the colour fringe are part of the look. Fix an artefact at its cause;
  do not flatten the effect to hide it.

## 3. Separators

Prefer space and grouping to a line. Where a line is right:

- **Inside one piece of glass: none.** Buttons that share a capsule are told apart by
  spacing. Nothing draws a shape around one of them, in any state: no rule, no border,
  no fill that the capsule's edge would cut (`.nav-group`).
- **Menus: a hairline between groups only**, inset from both edges (`.menu-sep`).
  Never between every item, never a band across the panel.
- **Lists: a hairline between rows**, inset to the text; none above the first row or
  below the last (`.row + .row::before`).
- Every separator is `var(--hairline)` thick and `var(--sep)` in colour. No `border`,
  no opaque greys, nothing thicker. `--sep` is for separators only.

## 4. Top bar

- At most three groups. Related symbol actions share one capsule (`navGroup`).
- Back, and the primary action, each stand alone.
- An action with a text label gets its own piece (`navPill`); beside a symbol it reads
  as one control.
- Symbols, not words, and no outlined-circle symbols: the glass is already the border.
- What does not fit goes in a More menu. Add one only when needed.
- Titles: a word or short phrase, under 15 characters.

## 5. Menus

- Most used first. Related items together, even when one is rarely used.
- Icons for every item in a group, or for none. No icon when none is clearly right.
- Destructive items last, red, in their own group.
- Title-Style Capitalization, no articles, an ellipsis only when more input follows.
- Keep them short; one level of submenu at most.

## 6. Shape

- Controls are capsules. Panels use large radii (menu 28, dialog 34, sheet 38).
- **Radii are concentric**: inner radius = outer radius − padding. A menu item is
  28 − 6 = 22; a grouped button is 22 − 3 = 19.
- Anything tappable takes a tap over at least 44 × 44, whatever its drawn size.

## 7. Feedback and motion

- Pressed glass swells and lights up where it was touched (`.interactive`, `--press`,
  `.glass::after`). Pressed content recedes (`.pressable`). Neither changes colour in
  blocks.
- Popovers are not new layers that fade in: the control that was tapped becomes the
  menu or dialog and collapses back into it (`UI.popover`).
- Only a control becomes a popover, never content. Content that can be changed (your
  own avatar) stays in view and carries a glass badge; the badge is what opens, centred
  on the content it belongs to (`NT.media.editable`, `align: 'center'`).
- An animation is right in every frame, not only once it has settled. The last
  animated frame and the frame after the swap are identical.
- An action never navigates as a side effect.
- Defaults are the quiet state: closed, collapsed, unselected.

## 8. Colour and type

- Colours come from tokens (`css/tokens.css`), by meaning: `--label`, `--label-2`,
  `--label-3` for text, `--fill`, `--fill-2` for control backgrounds, `--surface` for
  content, `--accent` for the tint. Never a raw value in a component.
- A colour means one thing. The accent marks what can be acted on and what is selected.
- Every colour works in light, dark, and over artwork.
- Text uses the type scale classes (`.title-1` … `.footnote`).

## 9. Copy

- Terse. No explanatory footers, no implementation notes, nothing about features that
  are not there.
- If the screen tells someone to do something, the control for it is on that screen.

## 10. Before calling a change done

- Both themes, over plain background and over artwork.
- At 1280 px wide with 150 % scaling, and at phone width.
- Hover, press, keyboard focus and open-menu states, not only rest.
- A frame from the middle of each animation it touches.
- Frame cost on real interactions (scrolling, changing tab or category, opening a
  menu), measured, not judged from screenshots.

## Sources

Apple Human Interface Guidelines, as read on 2026-11-10:

- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): where Liquid Glass belongs, regular and clear variants.
- [Color](https://developer.apple.com/design/human-interface-guidelines/color#Liquid-Glass-color): colour on glass, one tinted control.
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): grouping, symbols, the primary action, titles.
- [Menus](https://developer.apple.com/design/human-interface-guidelines/menus): order, groups and separators, icons, labels.

Sections 7, 9 and 10 are this project's own rules.
