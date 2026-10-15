# Dos mundos en una VM

## Estado al 15 de octubre de 2026

El código dual está publicado en GitHub y activo en Render con
`WORLD_MODE=dual`. Los seis webhooks por mundo y acción existen en Azure
Automation y sus URL están guardadas como variables privadas de Render.
También están configurados los dos hashes de autorización. El despliegue de
Render está activo y el bot registró sus comandos en ambos servidores de
Discord. Falta comprobar una interacción real desde Discord.

Colegio está en `/home/azureuser/minecraft`, puerto 25565. Universidad está en
`/home/azureuser/minecraft-universidad`, puerto 25566. Ambos servicios Paper
26.2 arrancaron simultáneamente en la VM de 4 GiB, cada uno con `-Xmx1280M`;
quedaron aproximadamente 1.7 GiB disponibles durante la prueba sin jugadores.
El runbook se probó con `start universidad`, `stop universidad` y otro
`start universidad`: Colegio permaneció activo y ambos servicios pudieron
escuchar simultáneamente en 25565/25566. Tras el segundo inicio había
aproximadamente 1.6 GiB disponibles sin jugadores. Al terminar la prueba se
detuvo Universidad; Colegio quedó activo. No se ejecutó la acción destructiva
`reset` sobre ninguno de los mundos.
La copia reciente de Colegio es
`/home/azureuser/minecraft-backups/colegio-before-authme-final-20261015T060807Z.tar.gz`
(SHA-256 `08492bf5048471f9950c043949f5c73cb21402e5bda1bcdcbd6176b4fcc47b21`).

Universidad tiene `eula=true` por autorización expresa del propietario. Azure
tiene una regla de entrada `Minecraft-Universidad-25566` que permite TCP
25566; se comprobó la conexión externa cuando Universidad estaba activo.
El arranque automático de `minecraft.service` quedó desactivado para que el
bot elija el mundo después de iniciar la VM.

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

Cada mundo tiene directorio, `server.properties`, mundo, lista de operadores,
lista de jugadores y servicio systemd propios. Colegio conserva el puerto
25565 y Universidad usa 25566. Ambos pueden ejecutarse a la vez. La VM tiene
4 GiB de RAM: ambos Java arrancan con
un máximo de 1280 MiB cada uno, dejando margen al sistema operativo y a la
memoria nativa de Java. Colegio consumía aproximadamente 1.4 GiB RSS con un
límite de 3 GiB y sin jugadores conectados; medir el consumo real con los dos
servidores activos y ajustar si hay presión de memoria. El arranque automático de
`minecraft.service` quedó desactivado al activar el modo dual.

Por elección expresa del propietario, ambos servidores usan
`online-mode=false`, sin whitelist ni autenticación dentro de Minecraft. La
clave de Discord protege únicamente el encendido, apagado y regeneración.
Mientras un mundo esté encendido, cualquiera que conozca su dirección puede
intentar entrar con un nombre no premium. Los OP `Jogate_2` y `JG2_SES206`
permanecen en Colegio; un tercero que suplante esos nombres podría recibir OP.
El propietario decidió conservarlos aun con ese riesgo. Universidad no tiene
OP preconfigurados. Si se quiere verificar identidades al entrar, hay que
incorporar autenticación dentro del juego o una aprobación por conexión en
Discord antes de considerar protegido el acceso de jugadores.

La autorización es una palabra clave diferente por mundo introducida en un
modal de Discord visible solo a quien ejecuta el comando. Render almacena
solo un hash con sal de cada palabra clave. El dato pasa por Discord para
llegar al bot: usar frases únicas de al menos 12 caracteres, nunca una
contraseña personal.
La palabra clave nunca debe registrarse en logs, incluirse en mensajes
públicos ni enviarse a Azure Automation. Las URL de los webhooks siguen siendo
secretos de Render. Las solicitudes de `/restart` se limitarán por usuario
para dificultar intentos de adivinar la palabra clave.

## Despliegue

Preparar y probar los dos servicios en la VM. `vm/minecraft-world-control.sh`
serializa acciones y solo admite los mundos y servicios fijados en el código;
`azure/Manage-MinecraftWorld.ps1` admite seis combinaciones fijas de mundo y
acción que se vinculan a seis webhooks separados. El runbook comprueba que el
agente de la VM responda antes de emitir la orden y desasigna la VM al parar
el último mundo. Después configurar las nuevas variables de entorno en
Render, desplegar el bot y probar los flujos de inicio, estado, parada y
regeneración de cada mundo sin borrar el mundo existente.

El EULA de Universidad ya fue aceptado y el servidor se probó dentro de la VM.
La regla de red de Azure permite 25565 y 25566. La prueba de ambos puertos
desde fuera de la VM fue satisfactoria mientras los dos servicios estaban
encendidos.

El código dual está activo en Render con `WORLD_MODE=dual`. Usa:

- MINECRAFT_HOST y DISCORD_GUILD_IDS (ya usados por el bot).
- MINECRAFT_PORT_COLEGIO y MINECRAFT_PORT_UNIVERSIDAD.
- WEBHOOK_VM_START, o se reutiliza el WEBHOOK_START ya configurado.
- WEBHOOK_COLEGIO_START, WEBHOOK_COLEGIO_STOP y WEBHOOK_COLEGIO_RESTART.
- WEBHOOK_UNIVERSIDAD_START, WEBHOOK_UNIVERSIDAD_STOP y WEBHOOK_UNIVERSIDAD_RESTART.
- WORLD_COLEGIO_PASSWORD_HASH y WORLD_UNIVERSIDAD_PASSWORD_HASH.

Cada hash se genera localmente con node scripts/hash-password.cjs. El script
oculta la entrada y muestra solo el hash para copiarlo a Render. No se deben
enviar las frases ni las URL de webhooks por chat ni guardarlas en Git.

## Comprobación pendiente

Ejecutar `/status` desde Discord y confirmar que muestra Colegio encendido y
Universidad apagado. Después se puede usar `/start`, elegir Universidad e
introducir su palabra clave para validar el flujo completo, y apagar solo
Universidad con `/stop`. La acción `/restart` borra y regenera el mundo elegido;
no se debe probar sobre un mundo con construcciones que se quieran conservar.
