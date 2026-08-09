import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return (
      request(app.getHttpServer())
        .get('/health')
        .expect(200)
        // `version` is stamped by the image build, so it is 'dev' here and a
        // real tag in a released container — asserted by shape, not value.
        .expect(200)
        .expect((res: { body: { status: string; version: string } }) => {
          expect(res.body.status).toBe('ok');
          expect(typeof res.body.version).toBe('string');
          expect(res.body.version.length).toBeGreaterThan(0);
        })
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
