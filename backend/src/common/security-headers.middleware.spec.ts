import type { Server } from 'node:http';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { securityHeaders } from './security-headers.middleware';

/**
 * Asserts the middleware `main.ts` actually installs, imported rather than
 * copied — a spec that re-declared the same three `setHeader` calls would
 * only prove the spec sets headers.
 *
 * Worth testing at all because nothing fails visibly if these disappear.
 * The consent pages carry no outbound links today, so a lost
 * `Referrer-Policy` leaks a parent's approval code only once someone adds
 * one, and by then nobody is looking.
 */
@Controller()
class PingController {
  @Get('ping')
  ping(): string {
    return 'ok';
  }
}

describe('securityHeaders', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(securityHeaders);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['referrer-policy', 'no-referrer'],
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
  ])('sets %s: %s', async (header, value) => {
    // `getHttpServer()` is typed `any`; naming it keeps the lint rules quiet
    // without an inline disable.
    const server = app.getHttpServer() as Server;
    const response = await request(server).get('/ping');
    expect(response.headers[header]).toBe(value);
  });
});
