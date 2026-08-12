import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ObjectStorageService } from '../video-clips/object-storage.service';
import { VideoProcessingService } from '../video-clips/video-processing.service';
import { readdir, readFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

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
   * 224x224 is not a model detail leaking upward — it is a privacy control
   * with a happy side effect. At that size a face is a dozen pixels wide,
   * so what crosses the boundary is legible as "a person doing something
   * on a court" and not as a recognisable child. The model wanting exactly
   * that size is convenient, not the reason.
   */
  async sample(storageKey: string, frameCount: number): Promise<Buffer[]> {
    const buffer = await this.objectStorageService.getObjectBuffer(storageKey);
    const sourcePath = await this.videoProcessingService.writeTempFile(
      buffer,
      'src',
    );
    const outputDir = await mkdtemp(join(tmpdir(), 'clip-frames-'));

    try {
      await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        // No audio reaches the output, and saying so explicitly is worth
        // the flag: a still image cannot carry sound, but the intent is
        // that a future change to this command cannot quietly start
        // exporting any.
        '-an',
        // Strip every piece of metadata. A clip's container can carry
        // creation time, device model and — the one that matters — GPS.
        // CLAUDE.md's "no location tracking" is a product rule, and this
        // is the point where a file could smuggle a location out of the
        // app cluster entirely.
        '-map_metadata',
        '-1',
        '-vf',
        `fps=1/1,scale=224:224:force_original_aspect_ratio=increase,crop=224:224`,
        '-frames:v',
        String(frameCount),
        '-q:v',
        '3',
        join(outputDir, 'frame%02d.jpg'),
      ]);

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
