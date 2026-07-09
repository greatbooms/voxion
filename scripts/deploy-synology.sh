#!/usr/bin/env sh
set -eu

APP_NAME="${APP_NAME:-voxion}"
API_CONTAINER_NAME="${API_CONTAINER_NAME:-voxion-api}"
WORKER_CONTAINER_NAME="${WORKER_CONTAINER_NAME:-voxion-worker}"
DEPLOY_PATH="${DEPLOY_PATH:?DEPLOY_PATH is required}"
IMAGE="${IMAGE:?IMAGE is required}"
DOCKER_BIN="${DOCKER_BIN:-/usr/local/bin/docker}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-.env.prod}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-.deploy.env}"
STORAGE_PATH="${STORAGE_PATH:-./storage}"
USE_SUDO_DOCKER="${USE_SUDO_DOCKER:-true}"

docker_cmd() {
  if [ "$USE_SUDO_DOCKER" = "true" ]; then
    sudo -n "$DOCKER_BIN" "$@"
  else
    "$DOCKER_BIN" "$@"
  fi
}

cd "$DEPLOY_PATH"

image_repository() {
  image_without_digest="${IMAGE%%@*}"
  printf '%s\n' "${image_without_digest%:*}"
}

cleanup_unused_app_images() {
  repository="$(image_repository)"
  current_image_id="$(docker_cmd image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)"

  if [ -z "$repository" ] || [ -z "$current_image_id" ]; then
    echo "[warn] Skipping image cleanup: current image not found"
    return
  fi

  echo "[info] Cleaning unused images for ${repository}"
  docker_cmd images "$repository" --format '{{.ID}}' | while IFS= read -r image_id; do
    if [ -z "$image_id" ]; then
      continue
    fi

    full_image_id="$(docker_cmd image inspect -f '{{.Id}}' "$image_id" 2>/dev/null || true)"
    if [ "$full_image_id" = "$current_image_id" ]; then
      continue
    fi

    if docker_cmd rmi "$image_id" >/dev/null 2>&1; then
      echo "[info] Removed unused image ${image_id}"
    else
      echo "[warn] Skipped image ${image_id}; it may still be in use"
    fi
  done
}

if [ ! -f "$RUNTIME_ENV_FILE" ]; then
  echo "[error] Missing runtime env file: ${DEPLOY_PATH}/${RUNTIME_ENV_FILE}"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[error] Missing compose file: ${DEPLOY_PATH}/${COMPOSE_FILE}"
  exit 1
fi

mkdir -p "$STORAGE_PATH"

{
  printf 'IMAGE=%s\n' "$IMAGE"
  printf 'STORAGE_PATH=%s\n' "$STORAGE_PATH"
} > "$DEPLOY_ENV_FILE"
chmod 600 "$DEPLOY_ENV_FILE"

echo "[info] Pulling ${IMAGE}"
docker_cmd compose --env-file "$DEPLOY_ENV_FILE" -f "$COMPOSE_FILE" pull

echo "[info] Starting ${APP_NAME}"
docker_cmd compose --env-file "$DEPLOY_ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

echo "[info] Waiting for API container health"
i=1
while [ "$i" -le 60 ]; do
  api_status="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$API_CONTAINER_NAME" 2>/dev/null || true)"
  worker_status="$(docker_cmd inspect -f '{{.State.Status}}' "$WORKER_CONTAINER_NAME" 2>/dev/null || true)"

  if [ "$api_status" = "healthy" ] && [ "$worker_status" = "running" ]; then
    echo "[info] ${API_CONTAINER_NAME} is healthy and ${WORKER_CONTAINER_NAME} is running"
    cleanup_unused_app_images
    exit 0
  fi

  echo "[info] api=${api_status:-unknown}; worker=${worker_status:-unknown}; waiting (${i}/60)"
  i=$((i + 1))
  sleep 2
done

echo "[error] ${APP_NAME} did not become healthy"
docker_cmd ps --filter "name=voxion"
docker_cmd logs --tail 120 "$API_CONTAINER_NAME" || true
docker_cmd logs --tail 120 "$WORKER_CONTAINER_NAME" || true
exit 1
