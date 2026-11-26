# Liquid Glass: design rules

This style is judged as an iOS app with Liquid Glass. Where Apple's Human Interface
Guidelines say something, that wins; the sources are at the end. Each rule names the
code that carries it (in this folder unless it says `js/`). The rules every style
shares are in [/DESIGN.md](../../DESIGN.md); these are on top of them.

## 1. Two layers

- **Glass is for controls and navigation only**: the tab bar, top buttons, menus,
  dialogs, sheets, toasts. Content (cards, lists, the editor, a test run's panel) is
  opaque and scrolls underneath. Never put `.glass` on content.
- The one exception is a control's moving part while it is held: a switch knob, slider
  thumb or segment thumb lifts into glass (`.lens`) and settles back.
- A knob that rests under labels (a segment's thumb, the tab bar's selection) is two
  layers that move as one: its face under the labels (`.lens-face`), its glass over
  them. The labels never change layer, so nothing covers them on the way up or down
  (`knobLayers`, ui.js).
- Code is content in a well inside its card (`.code-well`): a rectangle set in from the
  card's corners, so a line at the edge of the code is cut straight or not at all.
- Use glass sparingly. Repeated glass in content (the heart on a card) takes the light
  only, never the lens (`NT.glass.shine`, not `NT.glass.refract`).
- Content never cuts its own glass off. Glass that is held is pulled past its edge
  (section 7), so what carries it does not clip: a script's card and its cover take
  their corners themselves (`.card.script-card`, `.script-card > .cover`).
- A knob that is a drop while held (a switch's, a slider's) bends what is under it
  toward its middle and round at its rim, with a lit upper edge and a shaded lower one
  inside it (`KNOB_LENS`, `--_body`).
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
- What does not fit goes in a More menu. Add one only when needed. (The editor's
  capsule is Files, Test, More; Details is in More.)
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

Glass is liquid, not only glass. Its material has a presence and a thickness
(`--lg-k`, `--lg-t`, glass.css), and the lens takes the same values in every frame
(glass.js follows them). What moves it is in `liquid.js`.

- **Glass never fades.** It materializes: its bend, frost, fill, light and shadow grow
  from nothing while it swells out of a drop, and what is on it fades in
  (`NT.liquid.materialize`). It goes the same way back. Nothing animates `opacity` on a
  piece of glass; content on it may fade.
- **Glass that appears beside glass comes out of it**, and goes back into it: a neck
  joins the two until it thins and parts (`NT.liquid.split`, `absorb`). The top bar's
  pieces between pages, the accessory above the tab bar.
- **One piece of glass becomes the next** where it can: a toolbar piece changes width
  while its content changes (`morphBars`), a toast that is replaced takes the new words.
- **There is one toast.** The same words again make it swell for a moment and stay its
  time over; other words are taken by the glass that is there, each laid out at its own
  size while the glass changes shape around them; one that was going turns back from
  where it had got to (`UI.toast`).
- **A chain of glass is one piece all the way.** A sheet chosen from a menu is what the
  menu becomes: the menu does not go back into its button first, and the button is not
  there under the sheet. Button, menu, sheet, and the sheet back into the button
  (`handOver`, `UI.sheet`).
- What a panel collapses into is a copy of the control **as it is by then** (a value just
  picked is the new one), and the control itself is not shown under the copy: never two
  of the same thing, each part there.
- **Size is thickness.** Glass that grows into a menu, dialog or sheet thickens on the
  way (denser fill, more frost, deeper shadow, no colour split) and thins back on the
  way home, so it lands as the control it left: the last frame and the frame after the
  swap are the same, without a fade to hide anything (`UI.popover`, `UI.sheet`,
  `NT.glass.lensFrom`, `NT.liquid.exact`).
- Pressed glass swells, and the finger pulls it after itself, stretching past its edge
  (`NT.liquid` flex, through `scale` and `translate`). Its light starts under the finger,
  spreads through it and reaches the glass beside it (`.is-lit`, `.is-near`). Pressed
  content recedes (`.pressable`). Neither changes colour in blocks.
- A knob that lifts into glass (`.lens`) brings its lens in with its lift, never at
  once; it stretches with its speed (switch, segmented control, tab bar).
- Reduce Motion takes the elastic part away (no flex, no stretch); glass still comes
  and goes in place.
- Popovers are not new layers that fade in: the control that was tapped becomes the
  menu or dialog and collapses back into it (`UI.popover`).
- A dialog grows about the centre of the control it came from (`UI.confirm`). Only an
  action that loses something asks first: Reset does, Log Out does not. Delete does
  not ask either: it can be taken back for a few seconds, from Undo in its toast.
- A toast that can be acted on (Undo, Try Again, Sign In) has the action as a label in
  the accent at its trailing end, as an iOS banner does: no shape of its own inside the
  glass, dimming while held (`UI.toast`, `.toast-action`).
- When the service did not answer as the app started, the pages give way to one
  screen that says so, with Try Again (`app.js`, `.boot-down`).
- Only a control becomes a popover, never content. Content that can be changed (your
  own avatar) stays in view and carries a glass badge; the badge is what opens, centred
  on the content it belongs to (`NT.media.editable`, `align: 'center'`).
- An animation is right in every frame, not only once it has settled. The last
  animated frame and the frame after the swap are identical.
- Content that has not arrived is its own layout with the words and artwork left out,
  never a blank block (`ph`, `hold`). It dissolves into the content in place; nothing
  moves (`settle`).
- An action never navigates as a side effect. Search opens where it is pressed: on
  Scripts the page is what is found, anywhere else it comes up beside the field, out of
  its glass, and only Return or All Results goes to Scripts (`NT.tabbar`).
- Defaults are the quiet state: closed, collapsed, unselected.
- A new theme is every colour in one frame; nothing eases across it.
- A new accent eases. The accent is one colour that goes over to the next (`--accent`,
  tokens.css), so every label, fill and tint drawn in it is the same colour in each
  frame on the way. What marks the chosen colour is one ring that goes from the old
  choice to the new (`.swatch-ring`); it is never on two.
- A slider's thumb is where the finger is, between the steps as well as on them: its
  place is a spring toward the finger, so a press away from it is a glide, and it
  stretches along its way with its speed. The value is the nearest step, said as it
  changes; let go, the thumb settles on it (`UI.slider`).
- What a control opens, opens with the press. Where what it shows has to be asked
  for, the sheet is there at once with that part as a placeholder (`testSettings`,
  `historySheet`); nothing waits on the network before it moves.

## 8. Colour and type

- Symbols are the platform's: the set in `icons.js`, drawn to match SF Symbols (which
  are licensed for Apple's platforms only) at one weight, brought up to the weight of
  the words beside them. An action takes the symbol the guidelines name for it (Share
  is `square.and.arrow.up`, Duplicate `plus.square.on.square`, what a pop-up button
  carries is `chevron.up.chevron.down`). What is on is the filled symbol (a favourite
  is `heart.fill`), not the outline in another colour. No symbol is drawn by hand
  where the set has one.
- A script with no thumbnail of its own gets a cover of one colour (the core's,
  `NT.util.cover`) with one symbol on it, upright and whole: in the middle of a card,
  at the leading top corner where the cover carries words (`.cover-glyph`). Never
  several hues in one cover, and never a symbol cropped or turned.
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

Liquid motion (section 7), as read on 2026-11-15:

- [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) (WWDC25): materializing instead of fading, lensing, flexing and light spreading on touch, thicker material at larger sizes, elements lifting into glass.
- [Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/) (WWDC25): controls morphing into menus, dialogs and sheets; interactive glass scaling, bouncing and shimmering.
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views), [GlassEffectContainer](https://developer.apple.com/documentation/swiftui/glasseffectcontainer): shapes blending as they near each other, morphing apart and together.
- [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass): knobs transforming into glass, buttons morphing into menus and popovers.

Controls, symbols and covers, as read on 2026-11-26:

- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): the one exception to glass in content, "controls in the content layer with a transient interactive element like sliders and toggles; in these cases, the element takes on a Liquid Glass appearance to emphasize its interactivity when a person activates it".
- [Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders): a track, a thumb and a fill; live feedback as the value changes.
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion): feedback that follows the gesture, brief and precise; never a wait on an animation.
- [Icons](https://developer.apple.com/design/human-interface-guidelines/icons), [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols): one weight and level of detail across an app, matched to the text beside it; the standard symbols for common actions.
- [Framework7 Icons](https://framework7.io/icons/) 5.0.5 (MIT): the drawings in `icons.js`.

Sections 9 and 10, and the parts of 7 not covered above, are this project's own rules.
