# Dos mundos en una VM

## Estado actual

El bot usa tres webhooks de Azure Automation. `/start` enciende la VM y el
servicio `minecraft.service` inicia Paper automáticamente; `/stop` desasigna
la VM. El comando llamado `/restart` **borra el mundo** y genera uno nuevo.
Colegio está en `/home/azureuser/minecraft`, Paper 26.2, puerto 25565, con
`online-mode=false`, sin whitelist, y con SkinsRestorer y CleanPing. Hay una
copia íntegra previa a la migración en
`/home/azureuser/minecraft-backups/colegio-pre-dual-20261009T014135Z.tar.gz`
(SHA-256 `b52bcf67b08def0afb216a80ca703729818b891cde2aa0d55aba93bc4bb23308`).
El servicio volvió a quedar activo en 25565 tras crearla.

## Comportamiento objetivo

1. `/start` enciende la VM y muestra botones **Colegio** y **Universidad**.
2. El usuario elige el mundo y completa su autorización. Solo entonces un
   runbook inicia el servicio de ese mundo. El otro puede seguir activo.
3. `/status` muestra por separado ambos mundos, comprobando sus puertos.
4. `/stop` pide el mundo y su autorización; detiene solo ese servicio. La VM
   se desasigna únicamente si los dos servicios están apagados.
5. `/restart` pide el mundo y su palabra clave, muestra una confirmación
   final con el nombre del mundo y solo entonces archiva el mundo anterior y
   regenera **ese** mundo. Nunca debe afectar el otro.

Cada mundo tendrá directorio, `server.properties`, mundo, lista de operadores,
lista de jugadores y servicio systemd propios. Se propone conservar el puerto
25565 para el mundo existente, que será Colegio, y asignar 25566 a
Universidad. Ambos podrán estar
ejecutarse a la vez. La VM tiene solo 4 GiB de RAM: ambos Java empezarán con
un máximo de 1280 MiB cada uno, dejando margen al sistema operativo y a la
memoria nativa de Java. Colegio consumía aproximadamente 1.4 GiB RSS con un
límite de 3 GiB y sin jugadores conectados; medir el consumo real con los dos
servidores activos y ajustar si hay presión de memoria. El arranque automático de
`minecraft.service` deberá desactivarse después de preparar y verificar los
nuevos servicios.

Cada servidor tendrá su propia whitelist y base de autenticación. Ambos
grupos tienen jugadores no premium, por lo que `online-mode=false` es
necesario. En ese modo una whitelist sola no evita que alguien suplante un
nombre autorizado. Antes de abrir Universidad al público y dar por protegidos
los mundos hay que instalar y probar un complemento de autenticación dentro
del juego en cada servidor. La palabra clave protege los comandos del bot,
no el acceso directo al juego. Para evitar un bloqueo imprevisto de Colegio,
la instalación del complemento allí se hará cuando los jugadores sepan que
deberán registrarse e iniciar sesión.

La autorización será una palabra clave diferente por mundo introducida en un
modal de Discord visible solo a quien ejecuta el comando. Render almacenará
solo un hash con sal de cada palabra clave. El dato pasa por Discord para
llegar al bot: usar frases únicas de al menos 12 caracteres, nunca una
contraseña personal.
La palabra clave nunca debe registrarse en logs, incluirse en mensajes
públicos ni enviarse a Azure Automation. Las URL de los webhooks siguen siendo
secretos de Render. Las solicitudes de `/restart` se limitarán por usuario
para dificultar intentos de adivinar la palabra clave.

## Comprobaciones previas en la VM

Recoger la salida de `systemctl cat minecraft.service`, `free -h` y `df -h /`.
Confirmar si se requiere que ambos servidores estén encendidos a la vez.
Hacer una copia del mundo y de la unidad
systemd antes de modificar el arranque.

## Despliegue

Preparar y probar los dos servicios en la VM. `vm/minecraft-world-control.sh`
serializa acciones y solo admite los mundos y servicios fijados en el código;
`azure/Manage-MinecraftWorld.ps1` admite seis combinaciones fijas de mundo y
acción que se vinculan a seis webhooks separados. El runbook comprueba que el
agente de la VM responda antes de emitir la orden y desasigna la VM al parar
el último mundo. Después configurar las nuevas variables de entorno en
Render, desplegar el bot y probar los flujos de inicio, estado, parada y
regeneración de cada mundo sin borrar el mundo existente.

El nuevo servidor empieza con `eula=false`; hay que leer y aceptar el EULA
para poder iniciarlo. La regla de red de Azure solo permite hoy 25565, así que
25566 aún no será público hasta que se configure explícitamente. Colegio
sigue arrancando con la VM hasta que el bot, runbook y claves estén listos.

El código dual permanece desactivado hasta que Render tenga WORLD_MODE=dual.
Además necesita:

- MINECRAFT_HOST y DISCORD_GUILD_IDS (ya usados por el bot).
- MINECRAFT_PORT_COLEGIO y MINECRAFT_PORT_UNIVERSIDAD.
- WEBHOOK_VM_START, o se reutiliza el WEBHOOK_START ya configurado.
- WEBHOOK_COLEGIO_START, WEBHOOK_COLEGIO_STOP y WEBHOOK_COLEGIO_RESTART.
- WEBHOOK_UNIVERSIDAD_START, WEBHOOK_UNIVERSIDAD_STOP y WEBHOOK_UNIVERSIDAD_RESTART.
- WORLD_COLEGIO_PASSWORD_HASH y WORLD_UNIVERSIDAD_PASSWORD_HASH.

Cada hash se genera localmente con node scripts/hash-password.cjs. El script
oculta la entrada y muestra solo el hash para copiarlo a Render. No se deben
enviar las frases ni las URL de webhooks por chat ni guardarlas en Git.
