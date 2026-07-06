# Codex Instructions

이 파일은 `src/prisma` 하위에 적용됩니다.

## 역할

NestJS에서 Prisma Client를 주입하고 애플리케이션 종료 시 DB 연결을 정리하는 모듈입니다.

주요 기능:

- `PrismaService` 제공
- Prisma Client lifecycle 관리
- `enableShutdownHooks`를 통해 Nest app shutdown과 Prisma disconnect 연결

## 관련 파일

- `src/prisma/prisma.service.ts`
- `src/prisma/prisma.module.ts`
- `prisma/schema.prisma`
- `prisma/migrations/*`

## 주의사항

- DB schema 변경은 `prisma/schema.prisma`와 migration을 함께 봅니다.
- `Recording`, `RecordingChunk`, `JobRun` 관계와 cascade delete 영향을 확인합니다.
- BigInt/Decimal 값은 API 응답에서 JSON 직렬화 가능한 문자열로 변환합니다.
