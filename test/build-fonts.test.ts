import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readManifest, writeManifest } from '../src/manifest.js';

const fixturesUrl = new URL('./fixtures/', import.meta.url);
const barlowPath = fileURLToPath(new URL('Barlow-Regular.ttf', fixturesUrl));

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'maplibre-build-fonts-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadBuildFonts() {
  const { buildFonts } = await import('../src/index.js');
  return buildFonts;
}

function singleOptions(output: string, overrides: Record<string, unknown> = {}) {
  return {
    output,
    fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin', ...overrides }],
  };
}

describe('buildFonts: generation', () => {
  it('generates a single fontstack and returns a summary', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');

    const result = await buildFonts(singleOptions(output));

    expect(result).toEqual([{ fontstack: 'Barlow Regular', status: 'generated', fileCount: 1 }]);
    const written = await readFile(join(output, 'Barlow Regular', '0-255.pbf'));
    const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
    expect(Buffer.compare(written, expected)).toBe(0);
  }, 20000);

  it('generates multiple fontstacks into a shared output directory', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');

    const result = await buildFonts({
      output,
      fontstacks: [
        { font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin' },
        { font: barlowPath, fontstack: 'Barlow Copy', ranges: 'basic-latin' },
      ],
    });

    expect(result.map((r) => r.fontstack)).toEqual(['Barlow Regular', 'Barlow Copy']);
    expect(result.every((r) => r.status === 'generated')).toBe(true);
    expect((await readdir(join(output, 'Barlow Regular'))).sort()).toEqual(['0-255.pbf', 'fontstack.yaml']);
    expect((await readdir(join(output, 'Barlow Copy'))).sort()).toEqual(['0-255.pbf', 'fontstack.yaml']);
  }, 20000);

  it('leaves sibling files and other fontstacks untouched', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'unrelated.txt'), 'keep');
    await mkdir(join(output, 'Legacy Stack'));
    await writeFile(join(output, 'Legacy Stack', '0-255.pbf'), 'keep');

    await buildFonts(singleOptions(output));

    expect((await readdir(output)).sort()).toEqual(['Barlow Regular', 'Legacy Stack', 'unrelated.txt']);
    expect(await readFile(join(output, 'unrelated.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(output, 'Legacy Stack', '0-255.pbf'), 'utf8')).toBe('keep');
  }, 20000);

  it('refuses a non-empty fontstack folder that has no manifest', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');
    const fontstackDirectory = join(output, 'Barlow Regular');
    await mkdir(fontstackDirectory, { recursive: true });
    await writeFile(join(fontstackDirectory, 'foreign.pbf'), 'foreign');

    await expect(buildFonts(singleOptions(output))).rejects.toThrow(
      'Refusing to write to non-empty font stack directory',
    );
    expect((await readdir(fontstackDirectory)).sort()).toEqual(['foreign.pbf']);
  }, 20000);

  it('resolves font and output paths relative to the working directory', async () => {
    const buildFonts = await loadBuildFonts();
    await copyFile(barlowPath, join(workDir, 'font.ttf'));
    const previousCwd = process.cwd();
    process.chdir(workDir);

    try {
      await buildFonts({
        output: './out',
        fontstacks: [{ font: './font.ttf', fontstack: 'Barlow Regular', ranges: 'basic-latin' }],
      });
      await expect(access(join(workDir, 'out', 'Barlow Regular', '0-255.pbf'))).resolves.toBeUndefined();
    } finally {
      process.chdir(previousCwd);
    }
  }, 20000);
});

describe('buildFonts: caching', () => {
  it('skips regeneration on a second identical run', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');

    const first = await buildFonts(singleOptions(output));
    const second = await buildFonts(singleOptions(output));

    expect(first[0]!.status).toBe('generated');
    expect(second[0]!.status).toBe('skipped');
  }, 20000);

  it('writes a manifest with an empty axes block when no axes are given', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');

    await buildFonts(singleOptions(output));

    const manifest = await readManifest(join(output, 'Barlow Regular'));
    expect(manifest).not.toBeNull();
    expect(manifest!.ranges).toBe('basic-latin');
    expect(manifest!.axes).toEqual({});
    expect(Object.keys(manifest!.files)).toEqual(['0-255.pbf']);
  }, 20000);

  it.each([
    ['font hash', { fontSha256: 'deadbeef' }],
    ['ranges', { ranges: 'all-bmp' }],
    ['tool version', { toolVersion: '0.0.0-stale' }],
    ['axes', { axes: { wght: 700 } }],
  ])('regenerates when the %s changes', async (_label, patch) => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');
    const dir = join(output, 'Barlow Regular');

    await buildFonts(singleOptions(output));
    const manifest = await readManifest(dir);
    await writeManifest(dir, { ...manifest!, ...patch });

    const result = await buildFonts(singleOptions(output));
    expect(result[0]!.status).toBe('generated');
  }, 20000);

  it('regenerates when a generated file was deleted', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');
    const dir = join(output, 'Barlow Regular');

    await buildFonts(singleOptions(output));
    await rm(join(dir, '0-255.pbf'));

    const result = await buildFonts(singleOptions(output));
    expect(result[0]!.status).toBe('generated');
    await expect(access(join(dir, '0-255.pbf'))).resolves.toBeUndefined();
  }, 20000);

  it('regenerates when a generated file was modified on disk', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');
    const dir = join(output, 'Barlow Regular');

    await buildFonts(singleOptions(output));
    await writeFile(join(dir, '0-255.pbf'), 'corrupted');

    const result = await buildFonts(singleOptions(output));
    expect(result[0]!.status).toBe('generated');
    const written = await readFile(join(dir, '0-255.pbf'));
    const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
    expect(Buffer.compare(written, expected)).toBe(0);
  }, 20000);

  it('regenerates when its own manifest is corrupt rather than refusing', async () => {
    const buildFonts = await loadBuildFonts();
    const output = join(workDir, 'output');
    const dir = join(output, 'Barlow Regular');

    await buildFonts(singleOptions(output));
    await writeFile(join(dir, 'fontstack.yaml'), ':::not: valid: yaml:::');

    const result = await buildFonts(singleOptions(output));
    expect(result[0]!.status).toBe('generated');
    expect(await readManifest(dir)).not.toBeNull();
    expect((await readdir(dir)).sort()).toEqual(['0-255.pbf', 'fontstack.yaml']);
  }, 20000);
});

describe('buildFonts: validation', () => {
  it('rejects non-object options', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(buildFonts(undefined as never)).rejects.toThrow('requires an options object');
  });

  it('requires a non-empty output', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(
      buildFonts({ fontstacks: [{ font: barlowPath, fontstack: 'X' }] } as never),
    ).rejects.toThrow('output must be a non-empty string');
  });

  it('requires a non-empty fontstacks array', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(buildFonts({ output: join(workDir, 'o'), fontstacks: [] })).rejects.toThrow(
      'fontstacks must be a non-empty array',
    );
  });

  it('requires font and fontstack per entry', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(
      buildFonts({ output: join(workDir, 'o'), fontstacks: [{ fontstack: 'X' } as never] }),
    ).rejects.toThrow('fontstacks[0].font must be a non-empty string');
    await expect(
      buildFonts({ output: join(workDir, 'o'), fontstacks: [{ font: barlowPath } as never] }),
    ).rejects.toThrow('fontstacks[0].fontstack must be a non-empty string');
  });

  it('rejects an invalid ranges preset', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(
      buildFonts(singleOptions(join(workDir, 'o'), { ranges: 'foobar' })),
    ).rejects.toThrow('fontstacks[0].ranges must be one of');
  });

  it('rejects an invalid axis tag', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(
      buildFonts(singleOptions(join(workDir, 'o'), { axes: { weight: 400 } })),
    ).rejects.toThrow('Invalid variation axis tag');
  });

  it('rejects duplicate fontstack names', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(
      buildFonts({
        output: join(workDir, 'o'),
        fontstacks: [
          { font: barlowPath, fontstack: 'Barlow Regular' },
          { font: barlowPath, fontstack: 'Barlow Regular' },
        ],
      }),
    ).rejects.toThrow('Duplicate fontstack name');
  });

  it('reports a missing font file', async () => {
    const buildFonts = await loadBuildFonts();
    await expect(
      buildFonts(singleOptions(join(workDir, 'o'), { font: join(workDir, 'missing.ttf') })),
    ).rejects.toThrow('Font file not found');
  });
});

describe('buildFonts: library forwarding', () => {
  it('forwards font bytes, fontstack, ranges, and axes to generateGlyphPbfFiles', async () => {
    interface GenerateCall {
      fontstack: string;
      fonts: { name: string; bytes: Uint8Array; settings?: Record<string, number> }[];
      ranges: { start: number; end: number }[];
    }

    const generateGlyphPbfFiles = vi.fn(async (options: GenerateCall) => [
      { filename: `${options.fontstack}/0-255.pbf`, bytes: new Uint8Array([1, 2, 3]) },
    ]);

    vi.doMock('../src/generate-glyph-pbf-files.js', async (importActual) => {
      const actual = await importActual<typeof import('../src/generate-glyph-pbf-files.js')>();
      return { ...actual, generateGlyphPbfFiles };
    });

    const { buildFonts } = await import('../src/index.js');
    const output = join(workDir, 'output');

    await buildFonts({
      output,
      fontstacks: [
        { font: barlowPath, fontstack: 'With Axes', ranges: 'basic-latin', axes: { wght: 700 } },
        { font: barlowPath, fontstack: 'No Axes', ranges: 'basic-latin' },
      ],
    });

    const fontBytes = new Uint8Array(await readFile(barlowPath));
    expect(generateGlyphPbfFiles).toHaveBeenCalledTimes(2);

    const withAxes = generateGlyphPbfFiles.mock.calls[0]![0];
    expect(withAxes.fontstack).toBe('With Axes');
    expect(Buffer.compare(Buffer.from(withAxes.fonts[0]!.bytes), Buffer.from(fontBytes))).toBe(0);
    expect(withAxes.ranges).toEqual([{ start: 0, end: 255 }]);
    expect(withAxes.fonts[0]!.settings).toEqual({ wght: 700 });

    const noAxes = generateGlyphPbfFiles.mock.calls[1]![0];
    expect(noAxes.fonts[0]!.settings).toBeUndefined();
  });

  it('records axis values in the manifest', async () => {
    const generateGlyphPbfFiles = vi.fn(async (options: { fontstack: string }) => [
      { filename: `${options.fontstack}/0-255.pbf`, bytes: new Uint8Array([1, 2, 3]) },
    ]);
    vi.doMock('../src/generate-glyph-pbf-files.js', async (importActual) => {
      const actual = await importActual<typeof import('../src/generate-glyph-pbf-files.js')>();
      return { ...actual, generateGlyphPbfFiles };
    });

    const { buildFonts } = await import('../src/index.js');
    const output = join(workDir, 'output');

    await buildFonts(singleOptions(output, { fontstack: 'Inter Bold', axes: { wght: 700, wdth: 100 } }));

    const manifest = await readManifest(join(output, 'Inter Bold'));
    expect(manifest!.axes).toEqual({ wght: 700, wdth: 100 });
  });
});
