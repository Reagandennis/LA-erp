# syntax=docker/dockerfile:1
#
# wacli (https://wacli.sh) packaged as a long-lived sidecar for LA-ERP.
#
# The app does not run inside this container. It shells out to wacli through
# `docker exec` whenever WACLI_CONTAINER is set (see lib/wacli-runtime.ts), so
# the container just has to exist and stay up. `sleep infinity` keeps it alive;
# docker-compose adds `init: true` so exec'd processes are reaped.
#
# The official Linux release is linked against glibc, hence Debian rather than
# Alpine. ffmpeg matches the upstream image (voice-note conversion). sqlite3
# lets backups take consistent copies of the live stores (lib/backup/sources.ts).

FROM debian:bookworm-slim

ARG WACLI_VERSION=0.21.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg procps sqlite3 tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in amd64|arm64) ;; *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; esac; \
    base="https://github.com/openclaw/wacli/releases/download/v${WACLI_VERSION}"; \
    asset="wacli_${WACLI_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    cd /tmp; \
    curl -fsSL -o "${asset}" "${base}/${asset}"; \
    curl -fsSL -o checksums.txt "${base}/checksums.txt"; \
    grep " ${asset}\$" checksums.txt | sha256sum -c -; \
    mkdir -p /tmp/wacli-extract; \
    tar -xzf "${asset}" -C /tmp/wacli-extract; \
    install -m 0755 /tmp/wacli-extract/wacli /usr/local/bin/wacli; \
    rm -rf /tmp/wacli-extract "${asset}" checksums.txt; \
    wacli --version

# Non-root, with every wacli path pointed at the /data volume so linked
# sessions survive image rebuilds.
RUN useradd --system --uid 10001 --create-home --home-dir /home/wacli wacli \
    && mkdir -p /data/store /data/state /data/config /data/cache \
    && chown -R wacli:wacli /data

ENV HOME=/home/wacli \
    WACLI_STORE_DIR=/data/store \
    XDG_STATE_HOME=/data/state \
    XDG_CONFIG_HOME=/data/config \
    XDG_CACHE_HOME=/data/cache

VOLUME ["/data"]
WORKDIR /data
USER wacli

# Keep the container up; the app runs wacli inside it with `docker exec`.
CMD ["sleep", "infinity"]
