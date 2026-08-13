import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ObjectStorageService } from '../video-clips/object-storage.service';
import { VideoProcessingService } from '../video-clips/video-processing.service';
import { readdir, readFile, mkdtemp, rm } from 'fs/promises';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

interface FrameSamplingContract {
  videoFilter: string;
  extraArgs: string[];
  jpegQuality: string;
  defaultFrameCount: number;
}

/**
 * Shared with the Python eval harness. Read at module load rather than
 * duplicated, so the two cannot drift — see buildFfmpegArgs below.
 *
 * Found by walking up from `__dirname` in a checkout. **In the built
 * image it is not present** — it lives in `ai/`, outside this package's
 * build context — so a deployed pod uses the literal fallback below.
 *
 * That is deliberate rather than an oversight, but it only holds because
 * the fallback is itself asserted against the file in
 * clip-frame-sampler.service.spec.ts. Editing the contract without
 * editing the fallback fails CI, so the two cannot drift; without that
 * test this would be a copy waiting to go stale, which is exactly the
 * failure the shared file exists to prevent.
 */
const FRAME_SAMPLING_CONTRACT: FrameSamplingContract = loadContract();

function loadContract(): FrameSamplingContract {
  const candidates = [
    join(__dirname, '..', '..', 'frame-sampling-contract.json'),
    join(
      __dirname,
      '..',
      '..',
      '..',
      'ai',
      'clip-tagger',
      'frame-sampling-contract.json',
    ),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as FrameSamplingContract;
    } catch {
      continue;
    }
  }
  return {
    videoFilter:
      'fps=1/1,scale=224:224:force_original_aspect_ratio=increase,crop=224:224',
    extraArgs: ['-an', '-map_metadata', '-1'],
    jpegQuality: '3',
    defaultFrameCount: 8,
  };
}

const execFileAsync = promisify(execFile);

/**
 * Turns a stored clip into a handful of JPEG stills.
 *
 * This is docs/design/gpu-video-tagging-architecture.md Decision 4's
 * Option B, and it is the reason the whole feature is defensible: **no
 * media reference ever crosses the boundary.** The alternative — minting a
 * presigned GET and letting the analyser fetch — would hand a remote
 * cluster a URL that resolves to a child's full video, with audio. What
 * leaves here instead is a small number of derived, silent, downscaled
 * stills.
 *
 * The cost is real and was accepted deliberately: CPU on the API pod, and
 * the loss of all motion information (a model seeing eight stills cannot
 * tell a pass from a shot as well as one seeing the video).
 */
@Injectable()
export class ClipFrameSamplerService {
  private readonly logger = new Logger(ClipFrameSamplerService.name);

  constructor(
    private readonly objectStorageService: ObjectStorageService,
    private readonly videoProcessingService: VideoProcessingService,
  ) {}

  /**
   * Evenly-spaced stills, downscaled and centre-cropped to the model's
   * input size.
   *
   * 224x224 is a privacy control as well as a model input size, but the
   * claim it used to carry here — "a face is a dozen pixels" — was only
   * true for wide court shots. The filter scales to COVER and then
   * centre-crops, so a phone held at arm's length or a close-up drill
   * lands a face at 60-125px: reduced, but recognisable to a person and
   * within reach of face matching. A security review measured this.
   *
   * What is honestly true: what crosses the boundary is a small number of
   * reduced-resolution, silent, metadata-stripped, unlabelled stills. That
   * is a real reduction in what leaves and it is worth having. It is not
   * anonymisation, and it should never be described to a parent or a
   * regulator as though it were.
   */
  /**
   * The exact ffmpeg invocation, exposed so it can be asserted against
   * `ai/clip-tagger/frame-sampling-contract.json`.
   *
   * That file is the single source of truth, and it is shared because the
   * eval harness samples fixture clips the same way. The two had already
   * drifted once — the harness carried a `thumbnail,` filter this does not
   * use, which selects the most "representative" frames rather than
   * evenly-spaced ones, so it was grading the model on a nicer sample than
   * production sends. Every number it printed was optimistic and nothing
   * said so.
   */
  static buildFfmpegArgs(
    sourcePath: string,
    outputPattern: string,
    frameCount: number,
  ): string[] {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      ...FRAME_SAMPLING_CONTRACT.extraArgs,
      '-vf',
      FRAME_SAMPLING_CONTRACT.videoFilter,
      '-frames:v',
      String(frameCount),
      '-q:v',
      FRAME_SAMPLING_CONTRACT.jpegQuality,
      outputPattern,
    ];
  }

  async sample(storageKey: string, frameCount: number): Promise<Buffer[]> {
    // The output directory is created BEFORE the clip is written to
    // disk, and that ordering is the fix rather than a style choice:
    // `writeTempFile` puts an entire decrypted clip on the API pod's
    // disk, and when `mkdtemp` came second, a failure there (disk full,
    // EMFILE, /tmp permissions) skipped the `finally` below and left that
    // file behind indefinitely. Nothing sweeps /tmp on the API pod, so it
    // was exactly the "quiet accumulation" the cleanup comment claims to
    // prevent. Now the only thing between the clip hitting disk and the
    // `try` is nothing at all.
    const outputDir = await mkdtemp(join(tmpdir(), 'clip-frames-'));
    const buffer = await this.objectStorageService.getObjectBuffer(storageKey);
    const sourcePath = await this.videoProcessingService.writeTempFile(
      buffer,
      'src',
    );

    try {
      await execFileAsync(
        'ffmpeg',
        ClipFrameSamplerService.buildFfmpegArgs(
          sourcePath,
          join(outputDir, 'frame%02d.jpg'),
          frameCount,
        ),
      );

      const names = (await readdir(outputDir)).sort();
      const frames = await Promise.all(
        names.map((name) => readFile(join(outputDir, name))),
      );

      // A clip shorter than the sample window yields fewer frames than
      // asked for, which is fine — it is not an error, and the analyser
      // scores whatever it is given.
      return frames;
    } finally {
      // Both paths, always. These are frames of a child's video sitting on
      // an API pod's disk; leaving them there because an ffmpeg call threw
      // is exactly the kind of quiet accumulation this project's retention
      // rules exist to prevent.
      await this.videoProcessingService.deleteTempFileIfExists(sourcePath);
      await rm(outputDir, { recursive: true, force: true }).catch((error) => {
        this.logger.error(
          `Failed to clean up frame directory ${outputDir}: ${String(error)}`,
        );
      });
    }
  }
}
