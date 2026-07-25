import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSeconds: number | null;
  hasAudioStream: boolean;
}

interface FfprobeStream {
  codec_type?: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

/**
 * docs/adr/0010-video-storage-and-serving.md Decision 3 (blocking,
 * security-reviewer finding) — the mandatory metadata-stripping remux, plus
 * the non-blocking duration-integrity signal folded into the same pass.
 * Shells out to `ffmpeg`/`ffprobe` (installed in backend/Dockerfile's
 * runtime image) rather than a JS video-parsing library: this is exactly
 * the "boring, standard tool for the standard job" CLAUDE.md asks for, and
 * a stream-copy remux (`-c copy`, no re-encode) is cheap enough to run
 * synchronously in the `complete` request, per the ADR's own framing.
 *
 * Deliberately operates on local temp files, not in-memory streams piped
 * directly to/from ffmpeg — VideoClipsService already has to buffer the
 * whole object in memory to round-trip it through MinIO's GetObject/
 * PutObject APIs (a ~20s, ~25MB-capped clip is a trivial buffer size), so
 * temp files keep this service's own logic simple (ffmpeg/ffprobe are
 * ordinary file-in/file-out CLIs) without adding a second, harder-to-reason
 * about in-memory-stream code path for a scale this app doesn't need yet.
 */
@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  /** Writes `data` to a fresh temp file and returns its path — callers are
   * responsible for cleanup (see VideoClipsService's try/finally). */
  async writeTempFile(data: Buffer, extension: string): Promise<string> {
    const path = join(tmpdir(), `clip-${randomUUID()}.${extension}`);
    await fs.writeFile(path, data);
    return path;
  }

  async readTempFile(path: string): Promise<Buffer> {
    return fs.readFile(path);
  }

  async deleteTempFileIfExists(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `Failed to remove temp file ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Reports the object's actual duration and whether it has an audio
   * stream at all (some short clips are recorded muted/without a mic
   * track) — the latter drives remuxStripMetadata's explicit stream
   * mapping. Returns nulls/false on any ffprobe failure rather than
   * throwing: this is a best-effort integrity signal (ADR-0010 Decision 3's
   * non-blocking extension), never the mandatory step. */
  async probe(filePath: string): Promise<ProbeResult> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_entries',
        'format=duration',
        '-show_entries',
        'stream=codec_type',
        filePath,
      ]);
      const parsed = JSON.parse(stdout) as FfprobeOutput;
      const rawDuration = parsed.format?.duration;
      const durationSeconds =
        rawDuration !== undefined && !Number.isNaN(Number(rawDuration))
          ? Number(rawDuration)
          : null;
      const hasAudioStream = (parsed.streams ?? []).some(
        (stream) => stream.codec_type === 'audio',
      );
      return { durationSeconds, hasAudioStream };
    } catch (error) {
      this.logger.warn(
        `ffprobe failed for ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { durationSeconds: null, hasAudioStream: false };
    }
  }

  /**
   * The mandatory step (ADR-0010 Decision 3, security-reviewer finding,
   * blocking): `-map_metadata -1` drops all container/stream metadata
   * (location atoms like QuickTime's `com.apple.quicktime.location.ISO6709`
   * or Android's `loci`/`xyz`, device model, capture timestamps, etc.);
   * `-c copy` re-muxes the existing encoded streams losslessly, without
   * re-encoding — cheap, no quality loss, doesn't conflict with this ADR's
   * separate "no deep re-encoding" scope. Explicitly `-map`s only the first
   * video stream and (if present) the first audio stream — the security-
   * reviewer's non-blocking refinement — so an exotic action-camera
   * telemetry/GPS *stream* (e.g. GoPro's GPMF, a dedicated stream rather
   * than container metadata) is guaranteed dropped too, not just assumed
   * dropped by default stream-selection behavior.
   *
   * Throws on any ffmpeg failure (nonzero exit, e.g. a corrupt/unreadable
   * file) — the caller (VideoClipsService.completeUpload) catches this and
   * throws `ClipProcessingFailedException` (422), leaving the clip
   * `pending_upload`, never publishing an unprocessed file.
   */
  async remuxStripMetadata(
    inputPath: string,
    outputPath: string,
    hasAudioStream: boolean,
  ): Promise<void> {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      ...(hasAudioStream ? ['-map', '0:a:0'] : []),
      '-map_metadata',
      '-1',
      '-c',
      'copy',
      outputPath,
    ];
    await execFileAsync('ffmpeg', args);

    const stats = await fs.stat(outputPath).catch(() => null);
    if (!stats || stats.size === 0) {
      // ffmpeg exited 0 but produced nothing usable — treat identically to
      // a nonzero exit (both are "the remux did not succeed").
      throw new Error('ffmpeg produced an empty or missing output file.');
    }
  }
}
