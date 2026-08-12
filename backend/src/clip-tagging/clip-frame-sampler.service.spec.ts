import { readFileSync } from 'fs';
import { join } from 'path';
import { ClipFrameSamplerService } from './clip-frame-sampler.service';

/**
 * The cross-language guard.
 *
 * Frames are sampled in two places: here, for production, and in
 * `ai/clip-tagger/eval/run_fixtures.py`, for the evaluation that decides
 * the confidence threshold. If those two disagree, every number the
 * evaluation prints is measured on input the model will never receive.
 *
 * They HAD disagreed — the harness carried a `thumbnail,` filter this
 * service does not use, which picks the most "representative" frames in a
 * window instead of evenly-spaced ones. The harness was grading the model
 * on a nicer sample than production sends, the bias was upward, and
 * nothing announced it.
 *
 * So both sides now read one JSON file, and both sides assert against it.
 * Editing either without the other fails CI.
 */
describe('ClipFrameSamplerService ffmpeg contract', () => {
  const contractPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'ai',
    'clip-tagger',
    'frame-sampling-contract.json',
  );

  interface Contract {
    videoFilter: string;
    extraArgs: string[];
    jpegQuality: string;
  }

  function readContract(): Contract {
    return JSON.parse(readFileSync(contractPath, 'utf8')) as Contract;
  }

  it('the shared contract file exists', () => {
    // The service falls back to literals if this is missing, so without
    // this assertion a deleted contract would look fine here and silently
    // un-couple the two samplers.
    expect(() => readContract()).not.toThrow();
  });

  it('uses exactly the filter chain the eval harness uses', () => {
    const args = ClipFrameSamplerService.buildFfmpegArgs(
      '/tmp/in.mp4',
      '/tmp/out/frame%02d.jpg',
      8,
    );
    expect(args[args.indexOf('-vf') + 1]).toBe(readContract().videoFilter);
  });

  it('does not use ffmpeg thumbnail selection', () => {
    // Named explicitly rather than left to the equality check above: this
    // is the exact divergence that existed, and a reader should be able to
    // see why it is called out.
    const args = ClipFrameSamplerService.buildFfmpegArgs('a', 'b', 8);
    expect(args[args.indexOf('-vf') + 1]).not.toContain('thumbnail');
  });

  it('strips audio and all metadata', () => {
    // A clip container can carry GPS. This is the point where a file could
    // otherwise carry a location out of the app cluster, and CLAUDE.md's
    // "no location tracking" is a product rule, not a preference.
    const args = ClipFrameSamplerService.buildFfmpegArgs('a', 'b', 8);
    expect(args).toContain('-an');
    expect(args.join(' ')).toContain('-map_metadata -1');
    for (const extra of readContract().extraArgs) {
      expect(args).toContain(extra);
    }
  });

  it('asks for the frame count it was given', () => {
    const args = ClipFrameSamplerService.buildFfmpegArgs('a', 'b', 12);
    expect(args[args.indexOf('-frames:v') + 1]).toBe('12');
  });

  it('scales to the model input size, which is also the privacy bound', () => {
    // 224x224 leaves a face about a dozen pixels across. If this ever
    // grows, what crosses the cluster boundary becomes more identifiable
    // — so the number is pinned rather than left to the contract alone.
    expect(readContract().videoFilter).toContain('224:224');
  });
});
