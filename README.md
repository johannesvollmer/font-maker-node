# maplibre-font-maker-node

A TypeScript library for generating MapLibre-compatible glyph PBF files in memory from TTF, OTF, WOFF, or WOFF2 font bytes. 
Variable fonts are supported, but a specific instantiation must be chosen, so you should supply a value for each axis. 

## Usage

```ts
import { generateGlyphPbfFiles, latinRanges } from 'maplibre-font-maker-node';

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

## Use it as a build step

For generating glyphs to disk, the package exposes `buildFonts` — a higher-level wrapper around `generateGlyphPbfFiles` that reads fonts from disk, caches results, and writes the `.pbf` files. Instead of a config file, your "config" is a plain Node script, so you get loops, conditionals, and computed values for free:

```js
// generate-fonts.js  — run with: node generate-fonts.js
import { buildFonts } from 'maplibre-font-maker-node';

const weights = { Thin: 100, Regular: 400, Bold: 700 };

await buildFonts({
  output: './dist/fonts',
  fontstacks: Object.entries(weights).map(([label, wght]) => ({
    font: './fonts/Inter.woff2',
    fontstack: `Inter ${label}`,
    ranges: 'latin',           // optional: basic-latin | latin | all-bmp (default: latin)
    axes: { wght },            // optional: variable-font axes (4-char tag -> number)
  })),
});
```

This is an ES module using top-level `await` (Node 18+ with `"type": "module"` or a `.mjs` file). In CommonJS, use `buildFonts(...).catch((error) => { console.error(error); process.exitCode = 1; })` instead.

`buildFonts` writes the MapLibre-ready layout `<output>/<fontstack>/<start>-<end>.pbf`, e.g. `./dist/fonts/Inter Bold/0-255.pbf` — exactly the `{fontstack}/{range}.pbf` structure MapLibre's `glyphs` URL expects. Output directories are created automatically. Relative `font` and `output` paths resolve against the process working directory.

Wire it into a downstream project's lifecycle scripts:

```json
{
  "scripts": {
    "prebuild": "node ./generate-fonts.js"
  }
}
```

| Option | Description |
| --- | --- |
| `output` | Output directory shared by all font stacks. Required. |
| `fontstacks[].font` | Input font file path (TTF, OTF, WOFF, or WOFF2). Required. |
| `fontstacks[].fontstack` | MapLibre font stack name; also the output subfolder. Required and unique. |
| `fontstacks[].ranges` | Glyph range preset: `basic-latin`, `latin`, or `all-bmp`. Default: `latin`. |
| `fontstacks[].axes` | Variable-font axis settings, e.g. `{ wght: 700, wdth: 100 }`. The font is pinned to that instance before generating. Optional. |

`buildFonts` returns a per-fontstack summary (`{ fontstack, status: 'generated' | 'skipped', fileCount }[]`) and logs the same progress lines to the console. It throws (rejecting the promise) on any failure — missing/invalid options, font not found, generation error — so it fails the surrounding script in CI.

### Caching

Each font stack folder gets a `fontstack.yaml` manifest recording the font hash, fontstack, ranges, axes, tool version, and a hash of every generated file. On the next run `buildFonts` **skips generation** (status `skipped`) when all of those are unchanged and every output file is still intact, and **regenerates automatically** when any input changes (including a changed axis value) or an output file is missing or modified.

For safety, it **refuses to write into a non-empty fontstack folder that has no manifest** (i.e. content it didn't create); delete the folder to regenerate. Other files and folders in the output directory — including other font stacks — are never touched.

## API

```ts
buildFonts(options)            // read fonts from disk, cache, and write .pbf files
generateGlyphPbfFiles(options) // generate glyphs in memory, returns { filename, bytes }[]
range256(start)
basicLatinRanges()
latinRanges()
allBmpRanges()
```

`buildFonts` is the high-level, disk-oriented entry point (see [Use it as a build step](#use-it-as-a-build-step)). `generateGlyphPbfFiles` is the lower-level core: pass font **bytes** and get the glyph PBFs back in memory, with no file I/O or caching — use it when you already hold the bytes or want to handle output yourself.

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

In the settings, key must be a 4-character OpenType variation-axis tag and each value must be the fixed numeric axis value to instantiate. Unspecified axes are pinned to the font's default values when a variable font is normalized. 

## We use [font-maker](https://github.com/maplibre/font-maker) internally

This library wraps the MapLibre `font-maker` WebAssembly runtime, which is vendored under [`maplibre-font-maker/`](./maplibre-font-maker/README.md). See that directory's README for its source, checksums, and rebuild instructions.
