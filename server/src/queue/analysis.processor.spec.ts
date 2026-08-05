import { AnalysisProcessor } from './analysis.processor';

// The bug this guards: an unverified contract gets decompiled, the scan finds
// nothing (decompilation was lossy/failed), and the pipeline reported SECURE —
// telling the world a vulnerable contract was safe. Only a clean scan of
// VERIFIED source may say SECURE; everything else is INCONCLUSIVE.
describe('AnalysisProcessor.cleanResultStatus', () => {
  // cleanResultStatus uses none of the injected services, so dummies are fine.
  const p = new AnalysisProcessor(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const statusOf = (r: unknown) =>
    (p as unknown as { cleanResultStatus: (r: unknown) => string }).cleanResultStatus(r);

  it('SECURE only when verified source was scanned and nothing was found', () => {
    expect(statusOf({ source_type: 'verified_source' })).toBe('SECURE');
  });

  it('INCONCLUSIVE for decompiled bytecode (the false-secure bug)', () => {
    expect(statusOf({ source_type: 'decompiled' })).toBe('INCONCLUSIVE');
  });

  it('INCONCLUSIVE for bytecode-only', () => {
    expect(statusOf({ source_type: 'bytecode_only' })).toBe('INCONCLUSIVE');
  });

  it('INCONCLUSIVE when the analyzer failed (null/undefined result)', () => {
    expect(statusOf(null)).toBe('INCONCLUSIVE');
    expect(statusOf(undefined)).toBe('INCONCLUSIVE');
  });
});
