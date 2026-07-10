import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { IS_PUBLIC_ROUTE } from './public.decorator';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    if (this.auth.isRequestAuthorized(request)) {
      return true;
    }

    if (request.method === 'GET' && this.acceptsHtml(request)) {
      const response = http.getResponse<Response>();
      response.redirect(303, '/login');
      return false;
    }

    throw new UnauthorizedException('Authentication required.');
  }

  private acceptsHtml(request: Request): boolean {
    const accept = request.headers.accept ?? '';
    return accept.includes('text/html');
  }
}
