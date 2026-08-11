import { Test, TestingModule } from '@nestjs/testing';
import { DrillLibraryService } from '../drills/drill-library.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const originalVersion = process.env.APP_VERSION;
  afterEach(() => {
    if (originalVersion === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = originalVersion;
  });

  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DrillLibraryService,
          useValue: { list: () => [{ slug: 'a' }, { slug: 'b' }] },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns ok status', () => {
    // toEqual, not toMatchObject, on purpose: this is a public
    // unauthenticated endpoint, so its exact shape is the security
    // property. A field added here should fail this test and be argued
    // for, not arrive quietly.
    expect(controller.check()).toEqual({
      status: 'ok',
      version: 'dev',
      drills: 2,
    });
  });

  // The value the image was stamped with, so a running pod can be asked
  // what it actually is rather than what someone believes was deployed.
  it('reports the version stamped into the image', () => {
    process.env.APP_VERSION = 'v0.1.0';
    const controller = new HealthController({
      list: () => [{ slug: 'a' }, { slug: 'b' }],
    } as never);
    expect(controller.check()).toEqual({
      status: 'ok',
      version: 'v0.1.0',
      drills: 2,
    });
  });

  it('reports how many drills the image actually carried', () => {
    // The library ships inside the image and .dockerignore excludes *.md,
    // so "did this build carry the drills" is a real question a running
    // pod should answer — otherwise it surfaces as an empty shelf behind a
    // green CI.
    expect(controller.check().drills).toBe(2);
  });
});
