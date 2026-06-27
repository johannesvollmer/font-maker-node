# Vendored MapLibre `font-maker` runtime

The files in this directory are generated artifacts from MapLibre `font-maker`. They are third-party and must not be edited by hand.

- Source repository: `https://github.com/maplibre/font-maker`
- Source commit inspected for the wrapper API: `c56771948c59a01b89d0498d47dc4abf56c25338`
- Published artifacts used here:
  - `https://maplibre.org/font-maker/sdfglyph.js`
  - `https://maplibre.org/font-maker/sdfglyph.wasm`
- `sdfglyph.js` SHA-256: `2D5CCE9E20511E3E1798A696B496CFB4FB9C55CD9CCEAA73FD77849E1C3D7A64`
- `sdfglyph.wasm` SHA-256: `DE2986E66201499DE76F21BB3A649E1F27D7D68AF21CB2616DC3A7B25BADE691`

The upstream BSD-3-Clause license is included at [`LICENSE.font-maker`](./LICENSE.font-maker).

To rebuild the runtime from upstream, install Emscripten and Boost headers, initialize upstream submodules, then run:

```sh
./build_wasm.sh /path/to/boost
```
