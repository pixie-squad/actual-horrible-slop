UI work in this repo follows @DESIGN.md, and the rules of the style being worked on: `styles/<id>/DESIGN.md` (Liquid Glass: @styles/glass/DESIGN.md).

Each style is its own shell and pages in `styles/<id>/`; `js/` is the core they share and knows nothing of any style (`js/styles.js` lists them and says what a style provides).
