import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigService } from '../config/app-config.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { Public } from './public.decorator';

@Controller()
class GuardTestController {
  @Get('/private')
  privateRoute() {
    return { ok: true };
  }

  @Public()
  @Get('/public')
  publicRoute() {
    return { ok: true };
  }
}

const authConfig = {
  adminUsername: 'admin',
  adminPassword: 'correct-password',
  adminSessionSecret: 'test-session-secret-with-at-least-32-chars',
  adminSessionTtlSeconds: 3600,
  apiAccessToken: 'api-token',
};

describe('AdminAuthGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GuardTestController],
      providers: [
        AdminAuthService,
        { provide: AppConfigService, useValue: authConfig },
        { provide: APP_GUARD, useClass: AdminAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows public routes without credentials', async () => {
    await request(app.getHttpServer()).get('/public').expect(200, { ok: true });
  });

  it('rejects private API routes without credentials', async () => {
    await request(app.getHttpServer())
      .get('/private')
      .set('Accept', 'application/json')
      .expect(401);
  });

  it('allows private API routes with a bearer API token', async () => {
    await request(app.getHttpServer())
      .get('/private')
      .set('Authorization', 'Bearer api-token')
      .expect(200, { ok: true });
  });

  it('allows private API routes with an X-API-Key token', async () => {
    await request(app.getHttpServer())
      .get('/private')
      .set('X-API-Key', 'api-token')
      .expect(200, { ok: true });
  });

  it('redirects unauthenticated HTML navigation to the login page', async () => {
    await request(app.getHttpServer())
      .get('/private')
      .set('Accept', 'text/html')
      .expect(303)
      .expect('Location', '/login');
  });
});
