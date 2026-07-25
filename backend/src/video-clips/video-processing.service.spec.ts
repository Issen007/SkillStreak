import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { VideoProcessingService } from './video-processing.service';

const execFileAsync = promisify(execFile);

// This is the one unit-test file in this codebase that shells out to a
// real binary rather than mocking a dependency — deliberately, per
// docs/ACTION_PLAN.md's Phase 3 ask to "actually exercise the metadata-
// stripping step" rather than trust the ffmpeg invocation by inspection
// alone. `backend/Dockerfile`'s runtime image installs ffmpeg (`apk add
// ffmpeg`) specifically so this isn't a theoretical assertion; CI's
// ubuntu-latest runner also ships ffmpeg/ffprobe by default. A plain dev
// machine without either installed skips gracefully rather than failing —
// see ffmpegAvailable() below — since `pnpm test` shouldn't require a
// system dependency install just to run the rest of the suite.
async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    await execFileAsync('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

interface FfprobeFormatOutput {
  format?: { tags?: Record<string, string> };
}

async function readFormatTags(path: string): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_entries',
    'format_tags',
    path,
  ]);
  const parsed = JSON.parse(stdout) as FfprobeFormatOutput;
  return parsed.format?.tags ?? {};
}

describe('VideoProcessingService (real ffmpeg/ffprobe)', () => {
  let service: VideoProcessingService;
  let available = false;
  const tempFiles: string[] = [];

  beforeAll(async () => {
    available = await ffmpegAvailable();
    service = new VideoProcessingService();
    if (!available) {
      console.warn(
        'ffmpeg/ffprobe not found on PATH — skipping VideoProcessingService real-binary tests. ' +
          "These run for real in backend/Dockerfile's image and in CI.",
      );
    }
  });

  afterAll(async () => {
    await Promise.all(
      tempFiles.map((path) => fs.unlink(path).catch(() => undefined)),
    );
  });

  function trackTemp(path: string): string {
    tempFiles.push(path);
    return path;
  }

  /**
   * A synthetic clip standing in for a real device-recorded one — this
   * can't fabricate QuickTime's exact `com.apple.quicktime.location.
   * ISO6709` atom byte-for-byte, but embeds ordinary container-level
   * metadata tags (including one deliberately named after that same
   * location atom) via ffmpeg's own `-metadata` flag, which is exactly the
   * kind of format-level tag `-map_metadata -1` is documented to strip —
   * the point is proving the *mechanism* removes whatever container
   * metadata is present, not reproducing one specific camera app's byte
   * layout.
   */
  async function generateTestClip(options: {
    withAudio: boolean;
  }): Promise<string> {
    const path = trackTemp(join(tmpdir(), `test-clip-${randomUUID()}.mp4`));
    const inputs = options.withAudio
      ? [
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=1:size=64x64:rate=10',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=1',
        ]
      : ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10'];
    await execFileAsync('ffmpeg', [
      '-y',
      ...inputs,
      '-metadata',
      'location=+37.7749-122.4194/',
      '-metadata',
      'com.apple.quicktime.location.ISO6709=+37.7749-122.4194/',
      '-metadata',
      'title=SecretHomeVideo',
      '-c:v',
      'libx264',
      ...(options.withAudio ? ['-c:a', 'aac'] : []),
      '-shortest',
      path,
    ]);
    return path;
  }

  async function generateCorruptFile(): Promise<string> {
    const path = trackTemp(join(tmpdir(), `corrupt-clip-${randomUUID()}.mp4`));
    await fs.writeFile(path, Buffer.from('this is not a real video file'));
    return path;
  }

  it('probe() reports duration and hasAudioStream for a real clip', async () => {
    if (!available) return;
    const clipPath = await generateTestClip({ withAudio: true });

    const result = await service.probe(clipPath);

    expect(result.hasAudioStream).toBe(true);
    expect(result.durationSeconds).not.toBeNull();
    expect(result.durationSeconds as number).toBeGreaterThan(0.5);
    expect(result.durationSeconds as number).toBeLessThan(2);
  });

  it('probe() reports hasAudioStream: false for a video-only clip', async () => {
    if (!available) return;
    const clipPath = await generateTestClip({ withAudio: false });

    const result = await service.probe(clipPath);

    expect(result.hasAudioStream).toBe(false);
  });

  it('remuxStripMetadata actually removes embedded location/title metadata (the mandatory ADR-0010 Decision 3 step)', async () => {
    if (!available) return;
    const inputPath = await generateTestClip({ withAudio: true });
    const outputPath = trackTemp(`${inputPath}.stripped.mp4`);

    // Confirm the metadata is really there before stripping — otherwise a
    // trivial no-op remux could pass this test for the wrong reason.
    const tagsBefore = await readFormatTags(inputPath);
    expect(tagsBefore.location).toBeDefined();
    expect(tagsBefore.title).toBe('SecretHomeVideo');

    await service.remuxStripMetadata(inputPath, outputPath, true);

    const tagsAfter = await readFormatTags(outputPath);
    expect(tagsAfter.location).toBeUndefined();
    expect(tagsAfter['com.apple.quicktime.location.ISO6709']).toBeUndefined();
    expect(tagsAfter.title).toBeUndefined();

    // Still a real, playable video after the remux — a stream copy, not a
    // silently-empty output.
    const probeAfter = await service.probe(outputPath);
    expect(probeAfter.durationSeconds as number).toBeGreaterThan(0.5);
    expect(probeAfter.hasAudioStream).toBe(true);
  });

  it('remuxStripMetadata succeeds on a clip with no audio stream (hasAudioStream: false skips -map 0:a:0)', async () => {
    if (!available) return;
    const inputPath = await generateTestClip({ withAudio: false });
    const outputPath = trackTemp(`${inputPath}.stripped.mp4`);

    await expect(
      service.remuxStripMetadata(inputPath, outputPath, false),
    ).resolves.toBeUndefined();

    const stats = await fs.stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('remuxStripMetadata throws on a corrupt/unreadable input (the clip_processing_failed path)', async () => {
    if (!available) return;
    const inputPath = await generateCorruptFile();
    const outputPath = trackTemp(`${inputPath}.stripped.mp4`);

    await expect(
      service.remuxStripMetadata(inputPath, outputPath, false),
    ).rejects.toThrow();
  });

  it('writeTempFile/readTempFile/deleteTempFileIfExists round-trip correctly', async () => {
    const data = Buffer.from('hello clip bytes');
    const path = await service.writeTempFile(data, 'mp4');
    tempFiles.push(path);

    const readBack = await service.readTempFile(path);
    expect(readBack.equals(data)).toBe(true);

    await service.deleteTempFileIfExists(path);
    await expect(fs.stat(path)).rejects.toThrow();

    // Deleting again (already gone) must not throw.
    await expect(service.deleteTempFileIfExists(path)).resolves.toBeUndefined();
  });
});
