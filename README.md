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

## CLI

The same package ships a thin command-line wrapper around `generateGlyphPbfFiles`. It reads a font file, generates the glyphs, and writes them to disk.

```bash
npx maplibre-font-maker-node \
    --font ./fonts/Barlow-Regular.ttf \
    --fontstack "Barlow Regular" \
    --output ./dist/fonts \
    --ranges latin
```

This writes the MapLibre-ready layout `<output>/<fontstack>/<start>-<end>.pbf`, e.g. `./dist/fonts/Barlow Regular/0-255.pbf` — exactly the `{fontstack}/{range}.pbf` structure MapLibre's `glyphs` URL expects. Output directories are created automatically.

| Option | Description |
| --- | --- |
| `--font <path>` | Input font file (TTF, OTF, WOFF, or WOFF2). Required. |
| `--fontstack <name>` | MapLibre font stack name. Required. |
| `--output <dir>` | Output directory. Required. |
| `--ranges <preset>` | Glyph range preset: `basic-latin`, `latin`, or `all-bmp`. Default: `latin`. |
| `--force` | Regenerate even when the cached output is already up to date. |
| `--help` | Show usage. |
| `--version` | Show the package version. |

The CLI exits with code `1` on any failure (missing argument, font not found, invalid preset, generation error), so it fails the surrounding script in CI.

### Caching

Each run writes a `fontstack.yaml` manifest into `<output>/<fontstack>/` recording the font hash, fontstack, ranges, tool version, and a hash of every generated file. On the next run the command **skips generation** when all of those are unchanged and every output file is still intact, and **regenerates automatically** when any input changes or an output file is missing or modified. Pass `--force` to regenerate unconditionally.

For safety, the command **refuses to write into a non-empty fontstack folder that has no manifest** (i.e. content it didn't create) unless you pass `--force`. Other files and folders in the output directory — including other fontstacks — are never touched.

### Use it as a build step

Because npm exposes the binary on `node_modules/.bin`, you can call it by name from a downstream project's lifecycle scripts to generate glyphs into your build output:

```json
{
  "scripts": {
    "prebuild": "maplibre-font-maker-node --font ./fonts/Barlow-Regular.ttf --fontstack \"Barlow Regular\" --output ./dist/fonts --ranges latin"
  }
}
```

`prebuild` runs automatically before `build`. Thanks to the manifest cache, repeated builds are a fast no-op when the font and options are unchanged, and regenerate automatically when you swap the font or change the ranges — no `--force` needed. Each invocation handles one font; chain multiple commands with `&&` for several font stacks.

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

In the settings, key must be a 4-character OpenType variation-axis tag and each value must be the fixed numeric axis value to instantiate. Unspecified axes are pinned to the font's default values when a variable font is normalized. 

## We use [font-maker](https://github.com/maplibre/font-maker) internally

This library wraps the MapLibre `font-maker` WebAssembly runtime, which is vendored under [`maplibre-font-maker/`](./maplibre-font-maker/README.md). See that directory's README for its source, checksums, and rebuild instructions.
