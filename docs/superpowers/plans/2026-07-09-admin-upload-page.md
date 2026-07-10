# Admin Upload Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser upload page protected by environment-variable-based admin login and API token authentication.

**Architecture:** Keep the app as one NestJS service. Add a small auth module with an app-wide guard, a login/logout controller, and HMAC-signed HttpOnly cookie sessions. Add a web module that renders server-side HTML for `/upload`, and let the existing `POST /recordings` API handle the actual multipart upload.

**Tech Stack:** NestJS controllers/guards, Node `crypto`, server-rendered HTML, existing Multer upload API, Jest/Supertest.

---

### Task 1: Authentication Core

**Files:**
- Create: `src/auth/public.decorator.ts`
- Create: `src/auth/admin-auth.service.ts`
- Create: `src/auth/admin-auth.guard.ts`
- Create: `src/auth/auth.controller.ts`
- Create: `src/auth/auth.module.ts`
- Modify: `src/config/env.schema.ts`
- Modify: `src/config/app-config.service.ts`
- Modify: `src/app.module.ts`
- Modify: `src/health/health.controller.ts`
- Test: `src/auth/admin-auth.guard.spec.ts`
- Test: `src/auth/auth.controller.spec.ts`

- [ ] Write tests showing unauthenticated requests are blocked, API tokens are accepted, login sets an HttpOnly session cookie, and logout clears it.
- [ ] Implement config getters for `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_TTL_SECONDS`, and `API_ACCESS_TOKEN`.
- [ ] Implement HMAC-signed session cookies and constant-time secret comparisons.
- [ ] Register `AdminAuthGuard` as a global guard while marking `/health`, `/login`, `/auth/login`, and `/auth/logout` public.

### Task 2: Upload Web Page

**Files:**
- Create: `src/web/upload-page.ts`
- Create: `src/web/web.controller.ts`
- Create: `src/web/web.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/web/web.controller.spec.ts`

- [ ] Write tests showing unauthenticated HTML navigation redirects to `/login`.
- [ ] Write tests showing authenticated users can load `/upload`.
- [ ] Render a single-page upload UI with file/title/language/recordedAt inputs.
- [ ] Submit to `POST /recordings`, poll `GET /jobs/:id`, and display transcript from `GET /recordings/:id/transcript`.

### Task 3: Documentation And Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] Document admin login variables and API token usage.
- [ ] Document browser upload flow and curl examples with `Authorization: Bearer`.
- [ ] Run focused auth/web tests.
- [ ] Run `npm run build`.
- [ ] Commit with a Korean conventional commit message, then push/open a PR only when explicitly requested.
