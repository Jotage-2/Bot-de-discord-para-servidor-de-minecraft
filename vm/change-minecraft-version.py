#!/usr/bin/env python3
"""Change one Paper server after an explicit Discord confirmation.

Install at /usr/local/sbin/change-minecraft-version.py and run as root.
The previous JAR and world are retained under minecraft-backups.
"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zipfile

PROJECT = "https://fill.papermc.io/v3/projects/paper"
MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
USER_AGENT = "MinecraftDualWorldBot/1.0 (https://github.com/Jotage-2/Bot-de-discord-para-servidor-de-minecraft)"
VERSION = re.compile(r"\d+(?:\.\d+){1,2}\Z")
WORLDS = {
    "colegio": (Path("/home/azureuser/minecraft"), "minecraft.service", 25565),
    "universidad": (Path("/home/azureuser/minecraft-universidad"), "minecraft-universidad.service", 25566),
}
WORLD_FOLDERS = ("world", "world_nether", "world_the_end")
CONFIG_FILES = ("server.properties", "bukkit.yml", "spigot.yml", "paper-global.yml")
CONFIG_FOLDERS = ("plugins", "config")


def json_from(url):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=15) as response:
        return json.load(response)


def stable_download(version):
    manifest = json_from(MANIFEST)
    if version not in {item["id"] for item in manifest["versions"] if item["type"] == "release"}:
        raise ValueError("La versión no es un lanzamiento oficial de Minecraft Java.")
    builds = json_from(f"{PROJECT}/versions/{version}/builds")
    stable = [item for item in builds if item.get("channel") == "STABLE" and
              item.get("downloads", {}).get("server:default")]
    if not stable:
        raise ValueError("Paper no ofrece una compilación estable para esta versión.")
    build = max(stable, key=lambda item: int(item["id"]))
    download = build["downloads"]["server:default"]
    checksum = download["checksums"]["sha256"].lower()
    url = download["url"]
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname != "fill-data.papermc.io" or
            not re.fullmatch(r"[0-9a-f]{64}", checksum) or
            not parsed.path.startswith(f"/v1/objects/{checksum}/")):
        raise ValueError("La descarga de Paper no pasó la validación de origen e integridad.")
    return url, checksum


def download_jar(url, checksum, directory):
    fd, name = tempfile.mkstemp(prefix=".paper-update-", suffix=".jar", dir=directory)
    digest = hashlib.sha256()
    try:
        with os.fdopen(fd, "wb") as destination, urlopen(
                Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as source:
            while chunk := source.read(1024 * 1024):
                destination.write(chunk)
                digest.update(chunk)
        if digest.hexdigest() != checksum or not zipfile.is_zipfile(name):
            raise ValueError("La descarga de Paper no coincide con su SHA-256.")
        account = pwd.getpwnam("azureuser")
        os.chown(name, account.pw_uid, account.pw_gid)
        os.chmod(name, 0o644)
        return Path(name)
    except Exception:
        Path(name).unlink(missing_ok=True)
        raise


def run(*args, check=True, cwd=None):
    return subprocess.run(args, check=check, text=True, capture_output=True, timeout=180, cwd=cwd)


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def wait_port(port, active, seconds=120):
    for _ in range(seconds):
        if port_open(port) == active:
            return True
        time.sleep(1)
    return False


def bytes_used(path):
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def copy_preserving_owner(source, destination):
    run("cp", "-a", str(source), str(destination))


def remove_path(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def update(world, version, mode):
    directory, service, port = WORLDS[world]
    jar = directory / "paper.jar"
    if not jar.is_file() or not (directory / "server.properties").is_file():
        raise FileNotFoundError("No se encontraron paper.jar y server.properties del mundo elegido.")
    properties = (directory / "server.properties").read_text(errors="replace")
    if not re.search(r"^level-name=world\s*$", properties, flags=re.MULTILINE):
        raise ValueError("El mundo no usa level-name=world; se requiere revisión manual.")
    url, checksum = stable_download(version)
    candidate = download_jar(url, checksum, directory)
    backup = None
    started_new = False
    stopped = False
    was_running = run("systemctl", "is-active", "--quiet", service, check=False).returncode == 0
    try:
        # The CLI check catches an incompatible Java runtime before touching the old JAR.
        run("/usr/bin/java", "-jar", str(candidate), "--version", cwd=directory)
        sources = [directory / name for name in WORLD_FOLDERS + CONFIG_FILES + CONFIG_FOLDERS]
        copies = [item for item in sources if item.exists() and
                  (mode == "preserve" or item.name not in WORLD_FOLDERS)]
        required = sum(bytes_used(item) for item in copies) + 200 * 1024 * 1024
        if shutil.disk_usage(directory).free < required:
            raise OSError("No hay espacio suficiente para la copia previa; no se cambió la versión.")

        run("systemctl", "stop", service)
        stopped = True
        if not wait_port(port, False, 60):
            raise RuntimeError("El puerto sigue abierto; no se tocaron archivos del mundo.")
        run("systemctl", "reset-failed", service)

        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        backup = Path("/home/azureuser/minecraft-backups") / world / f"version-{stamp}-{os.getpid()}"
        backup.mkdir(mode=0o700, parents=True)
        os.chmod(backup, 0o700)
        for name in WORLD_FOLDERS:
            source = directory / name
            if source.exists():
                source.rename(backup / name)
                if mode == "preserve":
                    copy_preserving_owner(backup / name, source)
        for name in CONFIG_FILES + CONFIG_FOLDERS:
            source = directory / name
            if source.exists():
                copy_preserving_owner(source, backup / name)
        jar.rename(backup / "paper.jar")
        candidate.rename(jar)

        if was_running:
            started_new = True
            run("systemctl", "start", service)
            if not wait_port(port, True):
                raise RuntimeError("El servidor nuevo no abrió su puerto; se restaurará la copia.")
        print(f"Paper {version} instalado para {world}. Modo: {mode}. Copia: {backup}.")
        if not was_running:
            print("El servidor estaba apagado y permanece apagado.")
    except Exception:
        if backup is not None:
            run("systemctl", "stop", service, check=False)
            wait_port(port, False, 60)
            for name in WORLD_FOLDERS:
                source = directory / name
                saved = backup / name
                if saved.exists():
                    remove_path(source)
                    saved.rename(source)
            saved_jar = backup / "paper.jar"
            if saved_jar.exists():
                remove_path(jar)
                saved_jar.rename(jar)
            if started_new:
                for name in CONFIG_FILES + CONFIG_FOLDERS:
                    saved = backup / name
                    if saved.exists():
                        remove_path(directory / name)
                        copy_preserving_owner(saved, directory / name)
            if was_running:
                run("systemctl", "start", service, check=False)
        elif stopped and was_running:
            run("systemctl", "start", service, check=False)
        raise
    finally:
        candidate.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world", choices=WORLDS)
    parser.add_argument("version")
    parser.add_argument("mode", choices=("preserve", "reset"))
    args = parser.parse_args()
    if not VERSION.fullmatch(args.version):
        parser.error("Formato de versión inválido")
    with open("/run/lock/minecraft-world-control.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        update(args.world, args.version, args.mode)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Cambio de versión falló: {exc}", file=sys.stderr)
        sys.exit(1)
