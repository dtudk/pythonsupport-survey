# A throwaway fresh Debian 13 server (same as psqdb) for running deploy/setup.sh and manage.sh by hand.
# systemd runs as PID 1, so systemctl, journalctl and cron behave like on the real machine.
FROM docker.io/library/debian:trixie

ARG DEBIAN_FRONTEND=noninteractive
# A stock server's packages plus git and CA certificates; setup.sh installs the rest.
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv cron tzdata git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

CMD ["/sbin/init"]
