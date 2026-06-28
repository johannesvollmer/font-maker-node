export interface GeneratedSummary {
  fontstack: string;
  fileCount: number;
  output: string;
}

export function printGenerated({ fontstack, fileCount, output }: GeneratedSummary): void {
  console.log(`Generated ${fileCount} file(s) for "${fontstack}" in ${output}.`);
}

export interface SkippedSummary {
  fontstack: string;
  output: string;
}

export function printUpToDate({ fontstack, output }: SkippedSummary): void {
  console.log(`Up to date - skipped "${fontstack}" in ${output}.`);
}

export function printRunSummary(generated: number, skipped: number): void {
  console.log(`Done. ${generated} generated, ${skipped} up to date.`);
}
