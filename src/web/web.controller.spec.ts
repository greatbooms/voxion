import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { AdminAuthService } from '../auth/admin-auth.service';
import { AuthController } from '../auth/auth.controller';
import { AppConfigService } from '../config/app-config.service';
import { WebController } from './web.controller';

const authConfig = {
  adminUsername: 'admin',
  adminPassword: 'correct-password',
  adminSessionSecret: 'test-session-secret-with-at-least-32-chars',
  adminSessionTtlSeconds: 3600,
  apiAccessToken: 'api-token',
};

describe('WebController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, WebController],
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

  it('redirects unauthenticated upload page requests to login', async () => {
    await request(app.getHttpServer())
      .get('/upload')
      .set('Accept', 'text/html')
      .expect(303)
      .expect('Location', '/login');
  });

  it('renders the upload page for authenticated admins', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ username: 'admin', password: 'correct-password' })
      .expect(303);

    const response = await request(app.getHttpServer())
      .get('/upload')
      .set('Cookie', login.headers['set-cookie'])
      .expect(200);

    expect(response.text).toContain('<form id="upload-form"');
    expect(response.text).toContain('name="file"');
    expect(response.text).toContain("fetch('/recordings'");
    expect(response.text).toContain("fetch(`/jobs/${jobId}`");
    expect(response.text).toContain("fetch(`/recordings/${recordingId}/transcript`");
  });

  it('redirects root to the upload page for authenticated admins', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ username: 'admin', password: 'correct-password' })
      .expect(303);

    await request(app.getHttpServer())
      .get('/')
      .set('Cookie', login.headers['set-cookie'])
      .expect(303)
      .expect('Location', '/upload');
  });
});
