# Voxion

녹음 파일을 업로드하면 OpenAI speech-to-text로 전사하고, 완료된 전사 결과를 Notion 데이터 소스에 페이지로 올리는 개인용 NestJS 서비스입니다.

## 주요 흐름

1. `POST /recordings`로 오디오 파일을 업로드합니다.
2. API 서버가 원본 파일과 작업 정보를 저장하고 BullMQ 작업을 큐에 넣습니다.
3. 워커가 `ffmpeg`로 오디오를 mono 64k MP3로 정규화합니다.
4. OpenAI 업로드 제한을 넘지 않도록 정규화된 파일을 `CHUNK_TARGET_BYTES` 이하 청크로 나눕니다.
5. 각 청크를 OpenAI STT에 보내고 결과를 문장 단위로 재구성해 병합합니다.
6. Notion 데이터 소스에 페이지를 만들고 `Voxion Transcript` 섹션 아래에 전사문을, `Voxion Chunks` 섹션 아래에 청크 타임스탬프를 append합니다.
7. 완료 후 원본 업로드, 정규화 MP3, 청크 MP3, 청크별 raw JSON을 삭제합니다. 최종 전사 텍스트는 DB와 Notion에 남고, 작은 `final.json`만 로컬에 보존합니다.

청크 분할은 `ffmpeg silencedetect`로 찾은 무음 경계를 우선 사용하고, 무음이 없으면 시간 기준으로 강제 분할합니다. 강제 분할 시에는 경계에서 단어가 잘리지 않도록 다음 청크가 2초 overlap을 두고 시작합니다. 잘라낸 청크가 목표 용량을 넘으면 자동으로 절반씩 재분할합니다. 긴 파일도 처리할 수 있도록 기본 청크 목표값은 `24_000_000` bytes로 보수적으로 잡았습니다.

완료 후 파일 정리는 best-effort입니다. 디스크 잠금이나 권한 문제로 정리에 실패해도 전사 작업은 완료 처리되고, 서버 로그에 경고가 남습니다.

## 필요 조건

- Node.js 20 이상
- npm
- `ffmpeg`, `ffprobe`
- PostgreSQL
- Redis
- OpenAI API key
- Notion integration token과 Notion data source ID

macOS에서 `ffmpeg`가 없다면:

```sh
brew install ffmpeg
ffmpeg -version
ffprobe -version
```

Ubuntu 계열에서는:

```sh
sudo apt-get update
sudo apt-get install -y ffmpeg
```

## 환경 변수 준비

로컬 개발용 `.env`를 만듭니다.

```sh
cp .env.example .env
```

`.env.example`에는 로컬 PostgreSQL/Redis 기본값이 들어 있고, 외부 서비스 키는 비워져 있습니다. 현재 기본 연결값은 아래 형태입니다.

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/voxion_db?schema=public&connection_limit=5"
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

이미 다른 프로젝트에서 Docker로 띄운 PostgreSQL/Redis를 사용할 경우, 해당 컨테이너의 포트, 비밀번호, DB 이름에 맞게 `.env`만 수정하면 됩니다. Redis에 비밀번호가 있으면 `REDIS_PASSWORD`에 넣습니다.

## OpenAI API key 발급

1. OpenAI Platform의 [API keys 페이지](https://platform.openai.com/api-keys)에 접속합니다.
2. 사용할 project를 선택한 뒤 새 secret key를 만듭니다.
3. 생성 직후에만 전체 key가 보이므로 바로 복사합니다. 잃어버리면 새 key를 만들어야 합니다.
4. `.env`에 넣습니다.

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
DEFAULT_TRANSCRIPTION_LANGUAGE=ko
```

OpenAI Help Center도 API key는 [API key page에서 생성/관리](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)한다고 안내합니다. key는 소스코드나 Git에 커밋하지 마세요. 이 저장소의 `.gitignore`는 `.env`를 제외하도록 설정되어 있습니다.

## Notion 연동 준비

이 앱은 Notion API `2026-03-11` 버전과 data source API를 사용합니다.

### 1. Notion integration 만들기

1. Notion [Developer portal](https://www.notion.so/profile/integrations)에 접속합니다.
2. 새 internal connection을 만듭니다. 개인용이면 internal connection이 가장 단순합니다.
3. Capabilities에서 최소한 아래 권한을 켭니다.
   - Read content: 기존 transcript 블록을 확인해 재시도 시 중복 append를 피하기 위해 필요합니다.
   - Insert content: 페이지 생성과 transcript 블록 append에 필요합니다.
   - Update content: stale transcript 블록을 정리하고 재시도할 때 필요합니다.
4. Configuration 탭에서 installation access token을 복사합니다.
5. `.env`에 넣습니다.

```env
NOTION_TOKEN=secret_...
NOTION_VERSION=2026-03-11
```

Notion 공식 quickstart도 internal connection 생성, access token 확인, 페이지 권한 부여를 기본 절차로 안내합니다: [Notion Developer quickstart](https://developers.notion.com/guides/get-started/quick-start).

### 2. 전사 결과를 받을 Notion 데이터 소스 만들기

Notion에서 새 database 또는 data source를 만들고 아래 속성을 정확한 이름과 타입으로 추가합니다.

| 속성 이름 | 타입 |
| --- | --- |
| `Name` | Title |
| `Status` | Select |
| `Language` | Text |
| `Model` | Text |
| `Duration Seconds` | Number |
| `Original Filename` | Text |
| `File Size MB` | Number |
| `Chunk Count` | Number |
| `Recorded At` | Date |
| `Uploaded At` | Date |
| `Recording Id` | Text (선택) |

`Status` select에는 최소 `Completed` 값을 추가해 두는 것을 권장합니다.

`Recording Id` 속성은 선택 사항입니다. 추가해 두면 워커가 재시도할 때 이미 만들어진 페이지를 recording ID로 찾아 재사용하므로, 드물게 발생할 수 있는 중복 페이지 생성을 막을 수 있습니다. 속성이 없어도 동작에는 문제가 없습니다.

그 다음 Notion 페이지나 데이터베이스 우측 상단 `...` 메뉴에서 `Add connections`를 눌러 방금 만든 integration을 연결합니다. 연결하지 않으면 Notion API가 `403` 또는 `404`로 실패할 수 있습니다.

### 3. `NOTION_DATA_SOURCE_ID` 찾기

가장 쉬운 방법은 Notion 데이터베이스 설정 메뉴에서 `Manage data sources`로 들어가 `Copy data source ID`를 사용하는 것입니다. Notion 문서도 데이터베이스 URL에서 ID를 확인하거나, database를 retrieve해서 `data_sources` 목록을 확인하는 방법을 안내합니다: [Retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source).

복사한 값을 `.env`에 넣습니다.

```env
NOTION_DATA_SOURCE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

하이픈이 포함된 UUID 형태여도 됩니다.

## 설치

```sh
npm install
npm run prisma:generate
```

DB가 아직 없다면 먼저 생성합니다.

```sh
psql "postgresql://postgres:postgres@localhost:5432/postgres" \
  -c 'CREATE DATABASE voxion_db;'
```

이미 `voxion_db`가 있으면 위 명령은 건너뜁니다. 그 다음 마이그레이션을 적용합니다.

```sh
npm run prisma:migrate -- --name init
```

## 실행

터미널 1개에서 API 서버를 실행합니다.

```sh
npm run start:dev
```

다른 터미널에서 워커를 실행합니다.

```sh
npm run start:worker
```

기본 API 주소는 `http://localhost:3000`입니다.

## API 사용 예시

녹음 파일 업로드:

```sh
curl -X POST http://localhost:3000/recordings \
  -F "file=@/path/to/meeting.m4a;type=audio/m4a" \
  -F "title=팀 미팅" \
  -F "language=ko" \
  -F "recordedAt=2026-07-03T09:00:00+09:00"
```

상태 조회:

```sh
curl http://localhost:3000/recordings/00000000-0000-4000-8000-000000000001
```

전사 결과 조회:

```sh
curl http://localhost:3000/recordings/00000000-0000-4000-8000-000000000001/transcript
```

전사가 완료되기 전에는 transcript endpoint가 현재 상태와 함께 `409 Conflict`를 반환합니다.

작업(job) 진행 상태 조회:

```sh
curl http://localhost:3000/jobs/00000000-0000-4000-8000-000000000003
```

`POST /recordings` 응답의 `jobId`를 사용합니다. DB에 기록된 작업 상태와 함께, Redis에 접근 가능하면 BullMQ 큐의 실시간 상태(`queue.state`, 진행률, 실패 사유)도 반환합니다.

## 유용한 명령

```sh
npm run build
npm run lint
npm test -- --runInBand
npx prisma validate
```

## NAS 배포

Synology NAS 배포는 `GitHub Actions + GHCR + Tailscale + SSH + Docker Compose` 방식으로 구성되어 있습니다.

관련 파일:

- `.github/workflows/deploy.yml`
- `Dockerfile`
- `deploy/compose.yml`
- `scripts/deploy-synology.sh`
- `docs/deployment-guide.md`

배포 전 NAS에 `/volume1/docker/voxion/.env.prod`와 공유 storage 디렉터리를 준비해야 합니다.
자세한 절차와 필요한 GitHub Actions Secrets는 [배포 가이드](docs/deployment-guide.md)를 확인하세요.

## 문제 해결

- `OPENAI_API_KEY is not configured.`: `.env`에 `OPENAI_API_KEY`가 없습니다.
- `Notion environment is not configured.`: `.env`에 `NOTION_TOKEN` 또는 `NOTION_DATA_SOURCE_ID`가 없습니다.
- Notion `403`: integration capability가 부족하거나 해당 데이터 소스에 connection을 추가하지 않았을 가능성이 큽니다.
- `ffmpeg` 또는 `ffprobe` 실행 실패: 설치 여부와 `PATH`를 확인합니다.
- 업로드 파일이 너무 큼: `MAX_UPLOAD_BYTES`를 조정할 수 있습니다. 기본값은 2GiB입니다.
- OpenAI STT 요청이 파일 크기로 실패: `CHUNK_TARGET_BYTES`를 더 낮춥니다. 기본값은 `24000000`입니다.

## 참고 문서

- OpenAI API keys: https://platform.openai.com/api-keys
- OpenAI API key Help Center: https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key
- Notion Developer quickstart: https://developers.notion.com/guides/get-started/quick-start
- Notion data source: https://developers.notion.com/reference/retrieve-a-data-source
- Notion create page: https://developers.notion.com/reference/post-page
- Notion retrieve block children: https://developers.notion.com/reference/get-block-children
- Notion append block children: https://developers.notion.com/reference/patch-block-children
