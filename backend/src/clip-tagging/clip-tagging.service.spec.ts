import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ClipFrameSamplerService } from './clip-frame-sampler.service';
import { ClipTaggingService } from './clip-tagging.service';
import { VideoClipTaggingStatus } from '../video-clips/entities/video-clip.entity';

interface InsertedTag {
  clipId: string;
  tag: string;
  confidence: number;
  source: string;
}

describe('ClipTaggingService', () => {
  let service: ClipTaggingService;
  let inserted: InsertedTag[];
  let statusUpdates: Array<[string, string]>;
  let leaseLive: boolean;
  let config: Record<string, string>;

  beforeEach(async () => {
    inserted = [];
    statusUpdates = [];
    leaseLive = true;
    config = {};

    const manager = {
      query: jest.fn((sql: string, params: unknown[]) => {
        if (sql.includes('FROM video_clip') && sql.includes('FOR UPDATE')) {
          return Promise.resolve(leaseLive ? [{ id: 'clip-1' }] : []);
        }
        if (sql.includes('UPDATE video_clip')) {
          statusUpdates.push([params[0] as string, params[1] as string]);
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
      getRepository: () => ({
        insert: (rows: InsertedTag[]) => {
          inserted.push(...rows);
          return Promise.resolve({});
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClipTaggingService,
        {
          provide: DataSource,
          useValue: {
            transaction: (callback: (m: unknown) => unknown) =>
              callback(manager),
            createQueryBuilder: () => ({
              update: () => ({
                set: () => ({
                  where: () => ({
                    execute: () => Promise.resolve({ affected: 1 }),
                  }),
                }),
              }),
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        { provide: ClipFrameSamplerService, useValue: { sample: jest.fn() } },
      ],
    }).compile();

    service = module.get(ClipTaggingService);
  });

  const provenance = {
    modelId: 'siglip-base-patch16-224',
    promptSetVersion: 'floorball-v1',
  };

  const apply = (scores: Array<{ tag: string; score: number }>) =>
    service.applyResult(
      '11111111-1111-1111-1111-111111111111',
      scores,
      provenance,
    );

  describe('vocabulary enforcement', () => {
    it('drops a tag this app does not recognise', async () => {
      // The enforcement point is here, not in the analyser. A model swap,
      // a prompt-set change or a buggy worker must never be able to write
      // a novel label into Postgres.
      await apply([
        { tag: 'shooting', score: 0.9 },
        { tag: 'nudity', score: 0.99 },
        { tag: 'child_face_detected', score: 0.99 },
      ]);

      expect(inserted.map((row) => row.tag)).toEqual(['shooting']);
    });

    it('never persists unclear_or_unrelated, however confident', async () => {
      // A stored one would be a durable machine-authored negative
      // judgement attached to a child's video. Its meaning is carried by
      // the absence of rows.
      await apply([{ tag: 'unclear_or_unrelated', score: 0.99 }]);

      expect(inserted).toHaveLength(0);
      expect(statusUpdates[0][1]).toBe(
        VideoClipTaggingStatus.NO_CONFIDENT_TAGS,
      );
    });

    it('records the model and prompt set that produced each row', async () => {
      // A prompt edit changes scores as surely as a model swap, so a row
      // that named only the model could not be traced to what produced it.
      await apply([{ tag: 'passing', score: 0.8 }]);
      expect(inserted[0].source).toBe('siglip-base-patch16-224/floorball-v1');
    });
  });

  describe('thresholding', () => {
    it('drops scores below the confidence threshold', async () => {
      await apply([
        { tag: 'shooting', score: 0.9 },
        { tag: 'passing', score: 0.1 },
      ]);
      expect(inserted.map((row) => row.tag)).toEqual(['shooting']);
    });

    it('marks a clip no_confident_tags when nothing clears the bar', async () => {
      // A normal, expected state — not a failure.
      await apply([{ tag: 'shooting', score: 0.05 }]);
      expect(inserted).toHaveLength(0);
      expect(statusUpdates[0][1]).toBe(
        VideoClipTaggingStatus.NO_CONFIDENT_TAGS,
      );
    });

    it('honours a configured threshold over the default', async () => {
      config['CLIP_TAGGING_CONFIDENCE_THRESHOLD'] = '0.95';
      await apply([{ tag: 'shooting', score: 0.9 }]);
      expect(inserted).toHaveLength(0);
    });

    it('keeps only the highest-scoring tags, up to the cap', async () => {
      await apply([
        { tag: 'shooting', score: 0.7 },
        { tag: 'passing', score: 0.9 },
        { tag: 'team_drill', score: 0.8 },
      ]);
      expect(inserted.map((row) => row.tag)).toEqual(['passing', 'team_drill']);
    });

    it('clamps and rounds confidence to what the column accepts', async () => {
      // numeric(4,3) with a CHECK in [0,1]. A violated CHECK would 500 and
      // strand the lease, so the clamp is the last line of defence.
      await apply([{ tag: 'shooting', score: 0.87654321 }]);
      expect(inserted[0].confidence).toBe(0.877);
    });
  });

  describe('lease integrity', () => {
    it('does not apply a result for an expired or unknown lease', async () => {
      // A late result from a worker whose lease was already reclaimed is a
      // normal race, not an error.
      leaseLive = false;
      const result = await apply([{ tag: 'shooting', score: 0.9 }]);

      expect(result.applied).toBe(false);
      expect(inserted).toHaveLength(0);
      expect(statusUpdates).toHaveLength(0);
    });

    it('reports success when the lease was live', async () => {
      expect((await apply([{ tag: 'shooting', score: 0.9 }])).applied).toBe(
        true,
      );
    });
  });

  describe('what the worker is told', () => {
    it('hands back a lease id and frames, and nothing that names a clip', async () => {
      // The single most important property of the pull topology: a fully
      // compromised worker holds anonymous stills and an opaque uuid.
      const module = await Test.createTestingModule({
        providers: [
          ClipTaggingService,
          {
            provide: DataSource,
            useValue: {
              // The claim is one CTE statement whose top level is a
              // SELECT, so this returns rows — the same shape Postgres
              // gives. Mocking `transaction` here previously hid a real
              // bug (TypeORM returns [rows, count] for UPDATE ...
              // RETURNING), which is why the mock now mirrors the actual
              // query rather than the method that used to wrap it.
              query: () =>
                Promise.resolve([
                  {
                    storage_key: 'clips/team-9/clip-1.mp4',
                    tagging_lease_id: '22222222-2222-2222-2222-222222222222',
                  },
                ]),
            },
          },
          { provide: ConfigService, useValue: { get: () => undefined } },
          {
            provide: ClipFrameSamplerService,
            useValue: { sample: () => Promise.resolve([Buffer.from('jpeg')]) },
          },
        ],
      }).compile();

      const lease = await module.get(ClipTaggingService).leaseNext();

      expect(Object.keys(lease ?? {}).sort()).toEqual(['frames', 'leaseId']);
      const serialised = JSON.stringify(lease);
      expect(serialised).not.toContain('clip-1');
      expect(serialised).not.toContain('team-9');
      expect(serialised).not.toContain('clips/');
      expect(serialised).not.toContain('.mp4');
    });
  });
});
