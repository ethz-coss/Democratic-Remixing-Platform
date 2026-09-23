#!/bin/sh
# Best-effort cleanup for stale Podman/Compose resources that can block reopen.
set -eu

# Remove legacy fixed-name containers from previous compose config versions.
docker rm -f remix_backend_dev remix_workspace_dev remix_frontend_dev >/dev/null 2>&1 || true

# Remove stale pods from interrupted podman-compose runs.
if command -v podman >/dev/null 2>&1; then
  podman pod rm -f remixplatform_default >/dev/null 2>&1 || true
  podman pod rm -f remix_platform_default >/dev/null 2>&1 || true
fi

# Repair bind-mount folders used by PocketBase code artifacts.
# Podman rootless userns can leave these owned by a subuid, which blocks edits
# from the host user and from keep-id mapped development containers.
repair_shared_dir() {
  dir="$1"
  mkdir -p "$dir"

  if [ ! -w "$dir" ]; then
    stale_dir="${dir}.stale-subuid.$$"
    tmp_dir="$(mktemp -d)"
    mv "$dir" "$stale_dir"
    cp -a "$stale_dir"/. "$tmp_dir"/ >/dev/null 2>&1 || true
    mkdir -p "$dir"
    cp -a "$tmp_dir"/. "$dir"/ >/dev/null 2>&1 || true
    rm -rf "$tmp_dir"

    if command -v podman >/dev/null 2>&1; then
      podman unshare rm -rf "$stale_dir" >/dev/null 2>&1 || true
    else
      rm -rf "$stale_dir" >/dev/null 2>&1 || true
    fi
  fi

  chmod -R u+rwX "$dir" >/dev/null 2>&1 || true
}

repair_shared_dir backend/pb_migrations
repair_shared_dir backend/pb_hooks
