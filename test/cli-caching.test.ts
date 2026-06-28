import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readManifest, writeManifest } from '../src/cli/manifest.js';

import type { Mock } from 'vitest';

const fixturesUrl = new URL('./fixtures/', import.meta.url);
const barlowPath = fileURLToPath(new URL('Barlow-Regular.ttf', fixturesUrl));

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'maplibre-font-cache-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

// Loads the CLI with generateGlyphPbfFiles wrapped in a spy that still calls the real
// implementation, so we can count how many times generation actually ran.
async function loadCli(): Promise<{ run: (argv: string[]) => Promise<void>; generate: Mock }> {
  vi.doMock('../src/index.js', async (importActual) => {
    const actual = await importActual<typeof import('../src/index.js')>();
    return { ...actual, generateGlyphPbfFiles: vi.fn(actual.generateGlyphPbfFiles) };
  });

  const index = await import('../src/index.js');
  const { run } = await import('../src/cli.js');

  return { run, generate: index.generateGlyphPbfFiles as unknown as Mock };
}

function argsFor(output: string, extra: string[] = []): string[] {
  return [
    '--font',
    barlowPath,
    '--fontstack',
    'Barlow Regular',
    '--output',
    output,
    '--ranges',
    'basic-latin',
    ...extra,
  ];
}

describe('cli caching', () => {
  it(
    'writes a manifest describing the inputs and generated files',
    async () => {
      const { run } = await loadCli();
      const output = join(workDir, 'output');

      await run(argsFor(output));

      const manifest = await readManifest(join(output, 'Barlow Regular'));
      expect(manifest).not.toBeNull();
      expect(manifest!.tool).toBe('maplibre-font-maker-node');
      expect(manifest!.fontstack).toBe('Barlow Regular');
      expect(manifest!.ranges).toBe('basic-latin');
      expect(typeof manifest!.fontSha256).toBe('string');
      expect(Object.keys(manifest!.files)).toEqual(['0-255.pbf']);
    },
    20000,
  );

  it(
    'skips regeneration on a second identical run',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');

      await run(argsFor(output));
      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(1);
    },
    20000,
  );

  it(
    'regenerates when the input font hash changes',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');

      await run(argsFor(output));
      const manifest = await readManifest(fontstackDirectory);
      await writeManifest(fontstackDirectory, { ...manifest!, fontSha256: 'deadbeef' });

      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when the requested ranges change',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');

      await run(argsFor(output));
      const manifest = await readManifest(fontstackDirectory);
      await writeManifest(fontstackDirectory, { ...manifest!, ranges: 'all-bmp' });

      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when the tool version changes',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');

      await run(argsFor(output));
      const manifest = await readManifest(fontstackDirectory);
      await writeManifest(fontstackDirectory, { ...manifest!, toolVersion: '0.0.0-stale' });

      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when a generated file was deleted',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');

      await run(argsFor(output));
      await rm(join(fontstackDirectory, '0-255.pbf'));

      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(2);
      await expect(access(join(fontstackDirectory, '0-255.pbf'))).resolves.toBeUndefined();
    },
    20000,
  );

  it(
    'regenerates when a generated file was modified on disk',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');

      await run(argsFor(output));
      await writeFile(join(fontstackDirectory, '0-255.pbf'), 'corrupted');

      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(2);
      const written = await readFile(join(fontstackDirectory, '0-255.pbf'));
      const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
      expect(Buffer.compare(written, expected)).toBe(0);
    },
    20000,
  );

  it(
    'regenerates when its own manifest is corrupt rather than refusing',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');

      await run(argsFor(output));
      await writeFile(join(fontstackDirectory, 'fontstack.yaml'), ':::not: valid: yaml:::');

      await run(argsFor(output));

      expect(generate).toHaveBeenCalledTimes(2);
      const manifest = await readManifest(fontstackDirectory);
      expect(manifest).not.toBeNull();
    },
    20000,
  );

  it(
    'always regenerates with --force even when up to date',
    async () => {
      const { run, generate } = await loadCli();
      const output = join(workDir, 'output');

      await run(argsFor(output));
      await run(argsFor(output, ['--force']));

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'refuses a non-empty fontstack folder that has no manifest, then regenerates with --force',
    async () => {
      const { run } = await loadCli();
      const output = join(workDir, 'output');
      const fontstackDirectory = join(output, 'Barlow Regular');
      await mkdir(fontstackDirectory, { recursive: true });
      await writeFile(join(fontstackDirectory, 'foreign.pbf'), 'foreign');

      await expect(run(argsFor(output))).rejects.toThrow(
        'Refusing to write to non-empty font stack directory',
      );

      await run(argsFor(output, ['--force']));

      expect((await readdir(fontstackDirectory)).sort()).toEqual(['0-255.pbf', 'fontstack.yaml']);
    },
    20000,
  );
});
