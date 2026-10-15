#!/usr/bin/env bash
# Installed as /usr/local/sbin/minecraft-world-control on the Azure VM.
set -Eeuo pipefail

action=${1:-}
world=${2:-}
case "$world" in
    colegio)
        directory=/home/azureuser/minecraft
        service=minecraft.service
        port=25565
        ;;
    universidad)
        directory=/home/azureuser/minecraft-universidad
        service=minecraft-universidad.service
        port=25566
        ;;
    *) echo 'Mundo no permitido.' >&2; exit 2 ;;
esac
case "$action" in start|stop|reset) ;; *) echo 'Acción no permitida.' >&2; exit 2 ;; esac

exec 9>/run/lock/minecraft-world-control.lock
flock -w 120 9

port_open() {
    ss -lnt | grep -Eq "[.:]${port}[[:space:]]"
}

stop_world() {
    systemctl stop "$service"
    for _ in $(seq 1 60); do
        if ! port_open; then
            # screen can exit with status 1 after a normal Minecraft stop.
            # Preserve crash reporting unless this was an intentional stop.
            systemctl reset-failed "$service"
            return 0
        fi
        sleep 1
    done
    echo "El puerto $port sigue abierto; no se tocarán archivos del mundo." >&2
    exit 1
}

case "$action" in
    start)
        systemctl start "$service"
        systemctl is-active --quiet "$service"
        echo "Iniciado $world."
        ;;
    stop)
        stop_world
        echo "Detenido $world."
        ;;
    reset)
        stop_world
        if [[ ! -d "$directory/world" ]]; then
            echo "Falta el mundo principal de $world; no se generará otro automáticamente." >&2
            exit 1
        fi
        backup=/home/azureuser/minecraft-backups/$world/$(date -u +%Y%m%dT%H%M%SZ)
        mkdir -p "$backup"
        chmod 700 "$backup"
        for name in world world_nether world_the_end; do
            if [[ -e "$directory/$name" ]]; then
                mv -- "$directory/$name" "$backup/$name"
            fi
        done
        echo "Mundo anterior archivado en $backup"
        systemctl start "$service"
        systemctl is-active --quiet "$service"
        echo "Regeneración iniciada para $world."
        ;;
esac
