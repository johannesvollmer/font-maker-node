import { parseArgs } from 'node:util';

import { RANGE_PRESETS } from './resolve-ranges.js';

export interface CliOptions {
  font: string;
  fontstack: string;
  output: string;
  ranges: string;
  force: boolean;
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; options: CliOptions };

const DEFAULT_RANGES = 'latin';

export function parseCliArgs(argv: string[]): ParsedArgs {
  let values;

  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        font: { type: 'string' },
        fontstack: { type: 'string' },
        output: { type: 'string' },
        ranges: { type: 'string', default: DEFAULT_RANGES },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  if (values.help) {
    return { kind: 'help' };
  }

  if (values.version) {
    return { kind: 'version' };
  }

  const font = requireOption(values.font, 'font');
  const fontstack = requireOption(values.fontstack, 'fontstack');
  const output = requireOption(values.output, 'output');
  const ranges = values.ranges ?? DEFAULT_RANGES;

  if (!RANGE_PRESETS.includes(ranges)) {
    throw new Error(
      `Invalid --ranges preset "${ranges}". Valid presets are: ${RANGE_PRESETS.join(', ')}.`,
    );
  }

  return {
    kind: 'run',
    options: { font, fontstack, output, ranges, force: values.force ?? false },
  };
}

function requireOption(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}
