import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { Public } from './public.decorator';

@Controller()
export class AuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Get('login')
  loginPage(@Res() response: Response) {
    response.type('html').send(renderLoginPage());
  }

  @Public()
  @Post('auth/login')
  login(
    @Body('username') username: string | undefined,
    @Body('password') password: string | undefined,
    @Res() response: Response,
  ) {
    if (!this.auth.validateAdminCredentials(username, password)) {
      response
        .status(401)
        .type('html')
        .send(renderLoginPage('아이디 또는 비밀번호가 올바르지 않습니다.'));
      return;
    }

    response.setHeader(
      'Set-Cookie',
      this.auth.createSessionCookie(String(username)),
    );
    response.redirect(303, '/upload');
  }

  @Public()
  @Post('auth/logout')
  logout(@Res() response: Response) {
    response.setHeader('Set-Cookie', this.auth.clearSessionCookie());
    response.redirect(303, '/login');
  }
}

function renderLoginPage(errorMessage?: string): string {
  const error = errorMessage
    ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>`
    : '';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Voxion Login</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f2933;
      background: #eef2f5;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(100%, 360px);
      background: #ffffff;
      border: 1px solid #d6dde5;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 10px 24px rgba(31, 41, 51, 0.08);
    }
    h1 {
      margin: 0 0 24px;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    label {
      display: grid;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 14px;
      font-weight: 600;
    }
    input {
      height: 42px;
      border: 1px solid #b8c2cc;
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
    }
    button {
      width: 100%;
      height: 42px;
      border: 0;
      border-radius: 6px;
      background: #0f766e;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .error {
      margin: 0 0 16px;
      padding: 10px 12px;
      border-radius: 6px;
      background: #fee2e2;
      color: #991b1b;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Voxion</h1>
    ${error}
    <form method="post" action="/auth/login">
      <label>
        아이디
        <input name="username" autocomplete="username" required>
      </label>
      <label>
        비밀번호
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">로그인</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
