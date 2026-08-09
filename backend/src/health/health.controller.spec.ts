import { Test, TestingModule } from '@nestjs/testing';
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
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns ok status', () => {
    expect(controller.check()).toEqual({ status: 'ok', version: 'dev' });
  });

  // The value the image was stamped with, so a running pod can be asked
  // what it actually is rather than what someone believes was deployed.
  it('reports the version stamped into the image', () => {
    process.env.APP_VERSION = 'v0.1.0';
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok', version: 'v0.1.0' });
  });
});
