# maplibre-font-pbf

A TypeScript library for generating MapLibre-compatible glyph PBF files in memory from TTF, OTF, WOFF, or WOFF2 font bytes. WOFF and WOFF2 inputs are detected from their first four magic bytes and normalized internally before glyph generation.

## Usage

```ts
import { generateGlyphPbfFiles, latinRanges } from 'font-maker-node';

const files = await generateGlyphPbfFiles({
  fontstack: 'Barlow Regular',
  fonts: [
    {
      name: 'Barlow Regular',
      bytes: ttfBytes,
    },
  ],
  ranges: latinRanges(),
});
```

The result is an array of in-memory files:

```ts
[
  {
    filename: 'Barlow Regular/0-255.pbf',
    bytes: Uint8Array,
  },
];
```

The caller is responsible for writing files to disk if desired. The public API does not read font files or write output files. The only filesystem access performed by the library is loading the vendored `vendor/sdfglyph.js` and `vendor/sdfglyph.wasm` runtime files during initialization.

## API

```ts
generateGlyphPbfFiles(options)
range256(start)
basicLatinRanges()
latinRanges()
allBmpRanges()
```

`basicLatinRanges()` returns the `0-255` MapLibre glyph range. `latinRanges()` returns `0-255`, `256-511`, and `512-767`. `allBmpRanges()` returns all 256 ranges covering the BMP.

## Web Fonts And Variable Settings

```ts
const files = await generateGlyphPbfFiles({
  fontstack: 'Inter Bold',
  fonts: [
    {
      name: 'Inter Bold',
      bytes: woff2Bytes,
      settings: {
        wght: 700,
      },
    },
  ],
  ranges: latinRanges(),
});
```

`fonts[].settings` is optional. When present, each key must be a 4-character OpenType variation-axis tag and each value must be the fixed numeric axis value to instantiate. Unspecified axes are pinned to the font's default values when a variable font is normalized. WOFF inputs start with `77 4F 46 46` (`wOFF`), and WOFF2 inputs start with `77 4F 46 32` (`wOF2`).

## Vendored runtime

The vendored runtime files are generated artifacts from MapLibre `font-maker`:

- Source repository: `https://github.com/maplibre/font-maker`
- Source commit inspected for the wrapper API: `c56771948c59a01b89d0498d47dc4abf56c25338`
- Published artifacts used here:
  - `https://maplibre.org/font-maker/sdfglyph.js`
  - `https://maplibre.org/font-maker/sdfglyph.wasm`
- `vendor/sdfglyph.js` SHA-256: `2D5CCE9E20511E3E1798A696B496CFB4FB9C55CD9CCEAA73FD77849E1C3D7A64`
- `vendor/sdfglyph.wasm` SHA-256: `DE2986E66201499DE76F21BB3A649E1F27D7D68AF21CB2616DC3A7B25BADE691`

The upstream BSD-3-Clause license is included at `vendor/LICENSE.font-maker`.

To rebuild the runtime from upstream, install Emscripten and Boost headers, initialize upstream submodules, then run:

```sh
./build_wasm.sh /path/to/boost
```
