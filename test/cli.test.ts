import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify as stringifyYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixturesUrl = new URL('./fixtures/', import.meta.url);
const barlowPath = fileURLToPath(new URL('Barlow-Regular.ttf', fixturesUrl));

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'maplibre-font-pbf-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

async function writeConfig(config: unknown): Promise<string> {
  const path = join(workDir, 'config.yaml');
  await writeFile(path, stringifyYaml(config));
  return path;
}

async function writeRawConfig(text: string): Promise<string> {
  const path = join(workDir, 'config.yaml');
  await writeFile(path, text);
  return path;
}

describe('cli', () => {
  it('generates files for a single fontstack', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    const config = await writeConfig({
      output,
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin' }],
    });

    await run([config]);

    const written = await readFile(join(output, 'Barlow Regular', '0-255.pbf'));
    const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
    expect(Buffer.compare(written, expected)).toBe(0);
  });

  it('generates multiple fontstacks into a shared output directory', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    const config = await writeConfig({
      output,
      fontstacks: [
        { font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin' },
        { font: barlowPath, fontstack: 'Barlow Copy', ranges: 'basic-latin' },
      ],
    });

    await run([config]);

    expect((await readdir(join(output, 'Barlow Regular'))).sort()).toEqual([
      '0-255.pbf',
      'fontstack.yaml',
    ]);
    expect((await readdir(join(output, 'Barlow Copy'))).sort()).toEqual([
      '0-255.pbf',
      'fontstack.yaml',
    ]);
  });

  it('resolves relative font and output paths against the config directory', async () => {
    const { run } = await import('../src/cli.js');
    await copyFile(barlowPath, join(workDir, 'font.ttf'));
    const config = await writeConfig({
      output: './out',
      fontstacks: [{ font: './font.ttf', fontstack: 'Barlow Regular', ranges: 'basic-latin' }],
    });

    await run([config]);

    await expect(
      access(join(workDir, 'out', 'Barlow Regular', '0-255.pbf')),
    ).resolves.toBeUndefined();
  });

  it('leaves sibling files and other fontstacks untouched', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'unrelated.txt'), 'keep');
    await mkdir(join(output, 'Legacy Stack'));
    await writeFile(join(output, 'Legacy Stack', '0-255.pbf'), 'keep');

    const config = await writeConfig({
      output,
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin' }],
    });

    await run([config]);

    expect((await readdir(output)).sort()).toEqual(['Barlow Regular', 'Legacy Stack', 'unrelated.txt']);
    expect(await readFile(join(output, 'unrelated.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(output, 'Legacy Stack', '0-255.pbf'), 'utf8')).toBe('keep');
  });

  it('refuses a non-empty fontstack folder that has no manifest', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    const fontstackDirectory = join(output, 'Barlow Regular');
    await mkdir(fontstackDirectory, { recursive: true });
    await writeFile(join(fontstackDirectory, 'foreign.pbf'), 'foreign');

    const config = await writeConfig({
      output,
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', ranges: 'basic-latin' }],
    });

    await expect(run([config])).rejects.toThrow('Refusing to write to non-empty font stack directory');
    expect((await readdir(fontstackDirectory)).sort()).toEqual(['foreign.pbf']);
  });
});

describe('cli argument and config validation', () => {
  it('requires a config file path', async () => {
    const { run } = await import('../src/cli.js');
    await expect(run([])).rejects.toThrow('Missing required config file path');
  });

  it('reports a missing config file', async () => {
    const { run } = await import('../src/cli.js');
    await expect(run([join(workDir, 'nope.yaml')])).rejects.toThrow('Config file not found');
  });

  it('reports malformed YAML', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeRawConfig('fontstacks: [');
    await expect(run([config])).rejects.toThrow('Failed to parse config file');
  });

  it('requires a top-level mapping', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeRawConfig('- one\n- two\n');
    await expect(run([config])).rejects.toThrow('must contain a YAML mapping');
  });

  it('requires output', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeConfig({
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular' }],
    });
    await expect(run([config])).rejects.toThrow('output must be a non-empty string');
  });

  it('requires a non-empty fontstacks array', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeConfig({ output: join(workDir, 'output'), fontstacks: [] });
    await expect(run([config])).rejects.toThrow('fontstacks must be a non-empty array');
  });

  it('requires font and fontstack per entry', async () => {
    const { run } = await import('../src/cli.js');
    const missingFont = await writeConfig({
      output: join(workDir, 'output'),
      fontstacks: [{ fontstack: 'Barlow Regular' }],
    });
    await expect(run([missingFont])).rejects.toThrow('fontstacks[0].font must be a non-empty string');

    const missingName = await writeConfig({
      output: join(workDir, 'output'),
      fontstacks: [{ font: barlowPath }],
    });
    await expect(run([missingName])).rejects.toThrow('fontstacks[0].fontstack must be a non-empty string');
  });

  it('rejects an invalid ranges preset', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeConfig({
      output: join(workDir, 'output'),
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', ranges: 'foobar' }],
    });
    await expect(run([config])).rejects.toThrow('fontstacks[0].ranges must be one of');
  });

  it('rejects an invalid axis tag', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeConfig({
      output: join(workDir, 'output'),
      fontstacks: [{ font: barlowPath, fontstack: 'Barlow Regular', axes: { weight: 400 } }],
    });
    await expect(run([config])).rejects.toThrow('Invalid variation axis tag');
  });

  it('rejects duplicate fontstack names', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeConfig({
      output: join(workDir, 'output'),
      fontstacks: [
        { font: barlowPath, fontstack: 'Barlow Regular' },
        { font: barlowPath, fontstack: 'Barlow Regular' },
      ],
    });
    await expect(run([config])).rejects.toThrow('Duplicate fontstack name');
  });

  it('reports a missing font file', async () => {
    const { run } = await import('../src/cli.js');
    const config = await writeConfig({
      output: join(workDir, 'output'),
      fontstacks: [{ font: join(workDir, 'missing.ttf'), fontstack: 'Barlow Regular', ranges: 'basic-latin' }],
    });
    await expect(run([config])).rejects.toThrow('Font file not found');
  });
});

describe('cli library forwarding', () => {
  it('forwards font bytes, fontstack, ranges, and axes to generateGlyphPbfFiles', async () => {
    interface GenerateCall {
      fontstack: string;
      fonts: { name: string; bytes: Uint8Array; settings?: Record<string, number> }[];
      ranges: { start: number; end: number }[];
    }

    const generateGlyphPbfFiles = vi.fn(async (options: GenerateCall) => [
      { filename: `${options.fontstack}/0-255.pbf`, bytes: new Uint8Array([1, 2, 3]) },
    ]);

    vi.doMock('../src/index.js', async (importActual) => {
      const actual = await importActual<typeof import('../src/index.js')>();
      return { ...actual, generateGlyphPbfFiles };
    });

    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    const config = await writeConfig({
      output,
      fontstacks: [
        { font: barlowPath, fontstack: 'With Axes', ranges: 'basic-latin', axes: { wght: 700 } },
        { font: barlowPath, fontstack: 'No Axes', ranges: 'basic-latin' },
      ],
    });

    await run([config]);

    const fontBytes = new Uint8Array(await readFile(barlowPath));
    expect(generateGlyphPbfFiles).toHaveBeenCalledTimes(2);

    const withAxes = generateGlyphPbfFiles.mock.calls[0]![0];
    expect(withAxes.fontstack).toBe('With Axes');
    expect(Buffer.compare(Buffer.from(withAxes.fonts[0]!.bytes), Buffer.from(fontBytes))).toBe(0);
    expect(withAxes.ranges).toEqual([{ start: 0, end: 255 }]);
    expect(withAxes.fonts[0]!.settings).toEqual({ wght: 700 });

    const noAxes = generateGlyphPbfFiles.mock.calls[1]![0];
    expect(noAxes.fontstack).toBe('No Axes');
    expect(noAxes.fonts[0]!.settings).toBeUndefined();
  });
});
