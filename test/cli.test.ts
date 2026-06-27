import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

describe('cli', () => {
  it('generates files into the output directory', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');

    await run([
      '--font',
      barlowPath,
      '--fontstack',
      'Barlow Regular',
      '--output',
      output,
      '--ranges',
      'basic-latin',
    ]);

    const written = await readFile(join(output, 'Barlow Regular', '0-255.pbf'));
    const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
    expect(Buffer.compare(written, expected)).toBe(0);
  });

  it('fails when an output file already exists without --force', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    await mkdir(join(output, 'Barlow Regular'), { recursive: true });
    await writeFile(join(output, 'Barlow Regular', '0-255.pbf'), 'stale');

    await expect(
      run(['--font', barlowPath, '--fontstack', 'Barlow Regular', '--output', output, '--ranges', 'basic-latin']),
    ).rejects.toThrow('Refusing to overwrite');
  });

  it('overwrites existing files with --force', async () => {
    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');
    await mkdir(join(output, 'Barlow Regular'), { recursive: true });
    await writeFile(join(output, 'Barlow Regular', '0-255.pbf'), 'stale');

    await expect(
      run([
        '--font',
        barlowPath,
        '--fontstack',
        'Barlow Regular',
        '--output',
        output,
        '--ranges',
        'basic-latin',
        '--force',
      ]),
    ).resolves.toBeUndefined();

    const written = await readFile(join(output, 'Barlow Regular', '0-255.pbf'));
    const expected = await readFile(new URL('expected/0-255.pbf', fixturesUrl));
    expect(Buffer.compare(written, expected)).toBe(0);
  });

  it('reports missing required arguments', async () => {
    const { run } = await import('../src/cli.js');

    await expect(run(['--fontstack', 'Barlow Regular', '--output', workDir])).rejects.toThrow(
      'Missing required option --font',
    );
    await expect(run(['--font', barlowPath, '--output', workDir])).rejects.toThrow(
      'Missing required option --fontstack',
    );
    await expect(run(['--font', barlowPath, '--fontstack', 'Barlow Regular'])).rejects.toThrow(
      'Missing required option --output',
    );
  });

  it('rejects an invalid range preset', async () => {
    const { run } = await import('../src/cli.js');

    await expect(
      run(['--font', barlowPath, '--fontstack', 'Barlow Regular', '--output', workDir, '--ranges', 'foobar']),
    ).rejects.toThrow('Invalid --ranges preset "foobar"');
  });
});

describe('cli library forwarding', () => {
  it('forwards font bytes, fontstack, and ranges to generateGlyphPbfFiles', async () => {
    interface GenerateCall {
      fontstack: string;
      fonts: { name: string; bytes: Uint8Array }[];
      ranges: { start: number; end: number }[];
    }

    const generateGlyphPbfFiles = vi.fn(async (_options: GenerateCall) => [
      { filename: 'Barlow Regular/0-255.pbf', bytes: new Uint8Array([1, 2, 3]) },
    ]);

    vi.doMock('../src/index.js', async (importActual) => {
      const actual = await importActual<typeof import('../src/index.js')>();
      return { ...actual, generateGlyphPbfFiles };
    });

    const { run } = await import('../src/cli.js');
    const output = join(workDir, 'output');

    await run(['--font', barlowPath, '--fontstack', 'Barlow Regular', '--output', output, '--ranges', 'basic-latin']);

    const fontBytes = new Uint8Array(await readFile(barlowPath));
    expect(generateGlyphPbfFiles).toHaveBeenCalledTimes(1);

    const call = generateGlyphPbfFiles.mock.calls[0]![0];

    expect(call.fontstack).toBe('Barlow Regular');
    expect(call.fonts).toHaveLength(1);
    expect(call.fonts[0]!.name).toBe('Barlow Regular');
    expect(Buffer.compare(Buffer.from(call.fonts[0]!.bytes), Buffer.from(fontBytes))).toBe(0);
    expect(call.ranges).toEqual([{ start: 0, end: 255 }]);

    const written = await readFile(join(output, 'Barlow Regular', '0-255.pbf'));
    expect(Buffer.compare(written, Buffer.from([1, 2, 3]))).toBe(0);
  });
});
