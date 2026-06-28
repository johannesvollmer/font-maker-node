import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify as stringifyYaml } from 'yaml';
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

async function writeConfig(overrides: Record<string, unknown> = {}): Promise<string> {
  const path = join(workDir, 'config.yaml');
  await writeFile(
    path,
    stringifyYaml({
      output: join(workDir, 'output'),
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin', ...overrides }],
    }),
  );
  return path;
}

function fontstackDir(): string {
  return join(workDir, 'output', 'Barlow Regular');
}

describe('cli caching', () => {
  it(
    'writes a manifest with an empty axes block when no axes are given',
    async () => {
      const { run } = await loadCli();
      const config = await writeConfig();

      await run([config]);

      const manifest = await readManifest(fontstackDir());
      expect(manifest).not.toBeNull();
      expect(manifest!.fontstack).toBe('Barlow Regular');
      expect(manifest!.ranges).toBe('basic-latin');
      expect(manifest!.axes).toEqual({});
      expect(Object.keys(manifest!.files)).toEqual(['0-255.pbf']);
    },
    20000,
  );

  it('records axis values in the manifest', async () => {
    const generateGlyphPbfFiles = vi.fn(async (options: { fontstack: string }) => [
      { filename: `${options.fontstack}/0-255.pbf`, bytes: new Uint8Array([1, 2, 3]) },
    ]);
    vi.doMock('../src/index.js', async (importActual) => {
      const actual = await importActual<typeof import('../src/index.js')>();
      return { ...actual, generateGlyphPbfFiles };
    });

    const { run } = await import('../src/cli.js');
    const config = await writeConfig({ axes: { wght: 700, wdth: 100 } });

    await run([config]);

    const manifest = await readManifest(fontstackDir());
    expect(manifest!.axes).toEqual({ wght: 700, wdth: 100 });
  });

  it(
    'skips regeneration on a second identical run',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      await run([config]);

      expect(generate).toHaveBeenCalledTimes(1);
    },
    20000,
  );

  it(
    'regenerates when the input font hash changes',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      const manifest = await readManifest(fontstackDir());
      await writeManifest(fontstackDir(), { ...manifest!, fontSha256: 'deadbeef' });

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when the requested ranges change',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      const manifest = await readManifest(fontstackDir());
      await writeManifest(fontstackDir(), { ...manifest!, ranges: 'all-bmp' });

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when the tool version changes',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      const manifest = await readManifest(fontstackDir());
      await writeManifest(fontstackDir(), { ...manifest!, toolVersion: '0.0.0-stale' });

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when the axes change',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      const manifest = await readManifest(fontstackDir());
      await writeManifest(fontstackDir(), { ...manifest!, axes: { wght: 700 } });

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
    },
    20000,
  );

  it(
    'regenerates when a generated file was deleted',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      await rm(join(fontstackDir(), '0-255.pbf'));

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
      await expect(access(join(fontstackDir(), '0-255.pbf'))).resolves.toBeUndefined();
    },
    20000,
  );

  it(
    'regenerates when a generated file was modified on disk',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      await writeFile(join(fontstackDir(), '0-255.pbf'), 'corrupted');

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
      const written = await readFile(join(fontstackDir(), '0-255.pbf'));
      const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
      expect(Buffer.compare(written, expected)).toBe(0);
    },
    20000,
  );

  it(
    'regenerates when its own manifest is corrupt rather than refusing',
    async () => {
      const { run, generate } = await loadCli();
      const config = await writeConfig();

      await run([config]);
      await writeFile(join(fontstackDir(), 'fontstack.yaml'), ':::not: valid: yaml:::');

      await run([config]);

      expect(generate).toHaveBeenCalledTimes(2);
      const manifest = await readManifest(fontstackDir());
      expect(manifest).not.toBeNull();
      expect((await readdir(fontstackDir())).sort()).toEqual(['0-255.pbf', 'fontstack.yaml']);
    },
    20000,
  );
});
