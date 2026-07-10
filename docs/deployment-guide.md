# 배포 가이드

Voxion의 기본 운영 배포 대상은 Synology NAS Container Manager입니다.
배포는 `GitHub Actions + GHCR + Tailscale + SSH + Docker Compose` 조합으로 동작합니다.

## 배포 구조

1. `main` 브랜치에 push 또는 GitHub Actions `workflow_dispatch`
2. GitHub Actions runner가 Tailscale OAuth로 tailnet 접속
3. Synology NAS SSH 포트와 SSH dry-run preflight 확인
4. Docker 이미지 빌드
5. GHCR에 `latest`와 commit SHA 태그 push
6. Synology NAS에 SSH 접속
7. `deploy/compose.yml`, `scripts/deploy-synology.sh` 업로드
8. NAS에서 `docker compose pull`
9. NAS에서 API/worker 컨테이너 기동
10. API 컨테이너 `/health` 확인, worker 실행 상태 확인
11. 현재 실행 중인 이미지를 제외한 예전 GHCR 이미지 정리

## 컨테이너 구성

- `voxion-api`
  - `PORT=3000`
  - `npx prisma migrate deploy && node dist/main`
  - `GET /health`로 Docker healthcheck 수행
- `voxion-worker`
  - `node dist/worker`
  - BullMQ transcription worker 실행

두 컨테이너는 같은 이미지를 사용하고, 같은 storage volume을 `/app/storage`에 마운트합니다.
API가 저장한 업로드 파일을 worker가 읽어야 하므로 이 공유 volume은 필수입니다.

## NAS 사전 준비

필수:

- Synology Container Manager
- Tailscale 설치 및 tailnet 접속
- SSH 활성화
- 배포 계정에서 비밀번호 없이 Docker 실행 가능
- NAS에서 GHCR 로그인 완료

Docker 권한 확인:

```sh
sudo -k
sudo -n /usr/local/bin/docker ps
sudo -n /usr/local/bin/docker compose version
```

배포 디렉터리:

```sh
sudo mkdir -p /volume1/docker/voxion
sudo chown -R eric:users /volume1/docker/voxion
mkdir -p /volume1/docker/voxion/storage
```

NAS에 운영 환경파일을 생성합니다.

```sh
vi /volume1/docker/voxion/.env.prod
```

필수 예시:

```env
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/voxion_db?schema=public&connection_limit=5
REDIS_KEY_PREFIX=prod:voxion:
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
OPENAI_API_KEY=
# 추천값은 gpt-4o-transcribe입니다. diarize는 품질/제약을 확인한 뒤에만 사용합니다.
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_TRANSCRIPTION_PROMPT=
OPENAI_TRANSCRIPTION_CONTEXT_CHARS=1200
OPENAI_POST_PROCESSING_ENABLED=false
OPENAI_POST_PROCESSING_MODEL=gpt-4.1
OPENAI_POST_PROCESSING_PROMPT=
OPENAI_POST_PROCESSING_MAX_INPUT_CHARS=24000
OPENAI_POST_PROCESSING_MAX_CHUNKS=8
DEFAULT_TRANSCRIPTION_LANGUAGE=ko
NOTION_TOKEN=
# Notion 페이지 Copy link의 database ID가 아니라 table data source ID를 넣습니다.
NOTION_TABLE_DATA_SOURCE_ID=
NOTION_VERSION=2026-03-11
STORAGE_ROOT=/app/storage
MAX_UPLOAD_BYTES=2147483648
CHUNK_TARGET_BYTES=24000000
# diarize 모델은 timeout 방지를 위해 600 이하를 권장합니다.
CHUNK_MAX_DURATION_SECONDS=1200
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_TTL_SECONDS=86400
ADMIN_COOKIE_SECURE=false
API_ACCESS_TOKEN=
PORT=3000
```

비밀값은 GitHub 이슈, PR, 채팅, 로그에 남기지 않습니다.
`ADMIN_SESSION_SECRET`과 `API_ACCESS_TOKEN`은 `openssl rand -hex 32`처럼 긴 랜덤 문자열로 생성하는 것을 권장합니다.

## GitHub Secrets

Repository → `Settings` → `Secrets and variables` → `Actions`

필수 시크릿:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `SYNOLOGY_HOST`
- `SYNOLOGY_PORT`
- `SYNOLOGY_USER`
- `SYNOLOGY_SSH_KEY`
- `SYNOLOGY_DEPLOY_PATH`

설명:

- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
  - Tailscale Admin Console의 OAuth Client
  - `auth_keys` writable scope 필요
- `SYNOLOGY_HOST`
  - NAS의 Tailscale IP 또는 hostname
- `SYNOLOGY_PORT`
  - NAS SSH 포트
- `SYNOLOGY_USER`
  - NAS 배포 계정
- `SYNOLOGY_SSH_KEY`
  - GitHub Actions가 사용할 private key 전체
- `SYNOLOGY_DEPLOY_PATH`
  - NAS 배포 기준 경로. 예: `/volume1/docker/voxion`

## 수동 확인

NAS에서 상태 확인:

```sh
cd /volume1/docker/voxion
sudo -n /usr/local/bin/docker compose --env-file .deploy.env -f compose.yml ps
sudo -n /usr/local/bin/docker logs --tail 120 voxion-api
sudo -n /usr/local/bin/docker logs --tail 120 voxion-worker
```

헬스체크:

```sh
curl http://localhost:3000/health
```

재기동:

```sh
cd /volume1/docker/voxion
sudo -n /usr/local/bin/docker compose --env-file .deploy.env -f compose.yml up -d
```

## 트러블슈팅

### API 컨테이너가 unhealthy

확인:

```sh
sudo -n /usr/local/bin/docker inspect voxion-api
sudo -n /usr/local/bin/docker logs --tail 200 voxion-api
```

자주 보는 원인:

- `.env.prod` 누락
- `DATABASE_URL` 오타 또는 DB 접근 실패
- `OPENAI_API_KEY`, `NOTION_TOKEN`, `NOTION_TABLE_DATA_SOURCE_ID` 누락
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` 누락 시 업로드 화면 로그인이 불가능함
- Prisma migration 실패

### worker가 재시작을 반복함

확인:

```sh
sudo -n /usr/local/bin/docker logs --tail 200 voxion-worker
```

자주 보는 원인:

- Redis 접속 실패
- shared storage volume 권한 문제
- `ffmpeg`/`ffprobe` 실행 실패

### GHCR pull 실패

NAS에서 GHCR 로그인을 확인합니다.

```sh
docker login ghcr.io -u greatbooms
sudo -n /usr/local/bin/docker pull ghcr.io/greatbooms/voxion:latest
```
