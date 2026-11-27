# @groundboard/png

The optional part of [groundboard](https://github.com/lamngockhuong/groundboard) that draws a board
as a PNG image, so an agent or a reviewer can look at the board it drew. `groundboard png` loads it
on demand; the main `groundboard` package does not carry its weight (a 16.5 MB download, about
32 MB installed, most of it fonts).

It runs Excalidraw's own `exportToSvg` in Node under a small DOM (linkedom) and rasterises the
SVG with [resvg](https://github.com/linebender/resvg). No browser is started, nothing is fetched,
and nothing leaves the machine.

## Use

Install it next to `groundboard`, at the same version:

```sh
npx -y -p groundboard@<version> -p @groundboard/png@<version> groundboard png board.json
npm install groundboard@<version> @groundboard/png@<version>
```

Then see `groundboard png --help` and the
[groundboard README](https://github.com/lamngockhuong/groundboard#draw-a-board-as-png) for the
options: theme, reading font, the cap on the image's long edge and when a board is cut into tiles.

The package also exports `renderPng(scene, options)`, which draws an Excalidraw scene and
returns the PNG bytes of each tile; its interface follows `groundboard png` and may change with it.

## Fonts

The fonts are the ones the groundboard viewer ships, from Excalidraw, converted to TrueType. Text
is drawn in the viewer's default reading font (Nunito) unless another is asked for. Frame names,
which Excalidraw sets in Helvetica, are drawn in Assistant; Liberation Sans, Excalidraw's
Helvetica stand-in, is not shipped because of its licence (GPL-2.0 with a font exception).

A line of text holding a character its font lacks, such as `→` in Excalifont, is drawn wholly in a
fallback font, where the viewer swaps only that character.

## Licence

MIT. The bundled software and the fonts are listed with their licences in
`dist/THIRD_PARTY_NOTICES.md`.
