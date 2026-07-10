import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';

const SESSION_COOKIE_NAME = 'voxion_admin_session';

type SessionPayload = {
  sub: string;
  exp: number;
};

@Injectable()
export class AdminAuthService {
  readonly sessionCookieName = SESSION_COOKIE_NAME;

  constructor(private readonly config: AppConfigService) {}

  validateAdminCredentials(username: unknown, password: unknown): boolean {
    if (
      !this.config.adminUsername ||
      !this.config.adminPassword ||
      !this.config.adminSessionSecret
    ) {
      return false;
    }

    return (
      this.safeEquals(String(username ?? ''), this.config.adminUsername) &&
      this.safeEquals(String(password ?? ''), this.config.adminPassword)
    );
  }

  isRequestAuthorized(request: Request): boolean {
    return this.isApiTokenAuthorized(request) || this.isSessionAuthorized(request);
  }

  createSessionCookie(username: string): string {
    const payload: SessionPayload = {
      sub: username,
      exp: Math.floor(Date.now() / 1000) + this.config.adminSessionTtlSeconds,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.sign(encodedPayload);
    const token = `${encodedPayload}.${signature}`;

    return `${SESSION_COOKIE_NAME}=${token}; ${this.cookieAttributes(
      this.config.adminSessionTtlSeconds,
    )}`;
  }

  clearSessionCookie(): string {
    return `${SESSION_COOKIE_NAME}=; ${this.cookieAttributes(0)}`;
  }

  private isApiTokenAuthorized(request: Request): boolean {
    if (!this.config.apiAccessToken) {
      return false;
    }

    const authorization = this.firstHeader(request.headers.authorization);
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    const apiKey = this.firstHeader(request.headers['x-api-key']);

    return (
      this.safeEquals(bearerToken ?? '', this.config.apiAccessToken) ||
      this.safeEquals(apiKey ?? '', this.config.apiAccessToken)
    );
  }

  private isSessionAuthorized(request: Request): boolean {
    if (!this.config.adminUsername || !this.config.adminSessionSecret) {
      return false;
    }

    const token = this.parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token) {
      return false;
    }

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
      return false;
    }

    if (!this.safeEquals(signature, this.sign(encodedPayload))) {
      return false;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<SessionPayload>;

      return (
        payload.sub === this.config.adminUsername &&
        typeof payload.exp === 'number' &&
        payload.exp > Math.floor(Date.now() / 1000)
      );
    } catch {
      return false;
    }
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.adminSessionSecret ?? '')
      .update(value)
      .digest('base64url');
  }

  private cookieAttributes(maxAgeSeconds: number): string {
    const attributes = [
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`,
    ];

    if (this.config.adminCookieSecure) {
      attributes.push('Secure');
    }

    return attributes.join('; ');
  }

  private parseCookies(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader) {
      return {};
    }

    return cookieHeader.split(';').reduce<Record<string, string>>(
      (cookies, pair) => {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex === -1) {
          return cookies;
        }

        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (key) {
          cookies[key] = value;
        }

        return cookies;
      },
      {},
    );
  }

  private firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private safeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
