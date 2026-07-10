import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigService } from '../config/app-config.service';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';

const authConfig = {
  adminUsername: 'admin',
  adminPassword: 'correct-password',
  adminSessionSecret: 'test-session-secret-with-at-least-32-chars',
  adminSessionTtlSeconds: 3600,
  apiAccessToken: undefined,
};

describe('AuthController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AdminAuthService,
        { provide: AppConfigService, useValue: authConfig },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('renders the login page', async () => {
    const response = await request(app.getHttpServer()).get('/login').expect(200);

    expect(response.text).toContain('<form');
    expect(response.text).toContain('name="username"');
    expect(response.text).toContain('name="password"');
  });

  it('sets an HttpOnly session cookie after successful login', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ username: 'admin', password: 'correct-password' })
      .expect(303)
      .expect('Location', '/upload');

    expect(response.headers['set-cookie'][0]).toContain(
      'voxion_admin_session=',
    );
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
  });

  it('rejects invalid login credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401);

    expect(response.text).toContain('아이디 또는 비밀번호가 올바르지 않습니다.');
  });

  it('clears the admin session cookie on logout', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .expect(303)
      .expect('Location', '/login');

    expect(response.headers['set-cookie'][0]).toContain(
      'voxion_admin_session=;',
    );
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=0');
  });
});
