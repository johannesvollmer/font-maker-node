# font-maker-node

A TypeScript library for generating MapLibre-compatible glyph PBF files in memory from TTF, OTF, WOFF, or WOFF2 font bytes. 
Variable fonts are supported, but a specific instantiation must be chosen, so you should supply a value for each axis. 

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

The caller is responsible for writing files to disk if desired. The public API does not read font files or write output files. The only filesystem access performed by the library is loading the vendored `maplibre-font-maker/sdfglyph.js` and `maplibre-font-maker/sdfglyph.wasm` runtime files during initialization.

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

## We use [font-maker](https://github.com/maplibre/font-maker) internally

This library wraps the MapLibre `font-maker` WebAssembly runtime, which is vendored under [`maplibre-font-maker/`](./maplibre-font-maker/README.md). See that directory's README for its source, checksums, and rebuild instructions.
