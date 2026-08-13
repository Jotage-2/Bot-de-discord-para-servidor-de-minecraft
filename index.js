const http = require("http");
require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require("discord.js");

const axios = require("axios");
const net = require("net");

// ============================================================
// CONFIGURACIÓN
// ============================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const WEBHOOK_START = process.env.WEBHOOK_START;
const WEBHOOK_STOP = process.env.WEBHOOK_STOP;
const WEBHOOK_RESTART = process.env.WEBHOOK_RESTART;

const MINECRAFT_HOST = process.env.MINECRAFT_HOST;
const MINECRAFT_PORT = Number(process.env.MINECRAFT_PORT || 25565);

// Cuánto tiempo máximo esperamos a que Minecraft arranque.
const START_TIMEOUT_MS = 180000; // 3 minutos

// Cada cuánto comprobamos el puerto 25565.
const CHECK_INTERVAL_MS = 5000;

// ============================================================
// CLIENTE DE DISCORD
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ============================================================
// COMANDOS SLASH
// ============================================================

const commands = [
    new SlashCommandBuilder()
        .setName("start")
        .setDescription("Enciende la VM y el servidor de Minecraft"),

    new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Guarda Minecraft y apaga completamente la VM"),

    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Comprueba si el servidor de Minecraft está online"),

    new SlashCommandBuilder()
        .setName("restart")
        .setDescription("BORRA el mundo actual y genera uno nuevo en Hardcore"),

    new SlashCommandBuilder()
        .setName("comandos")
        .setDescription("Muestra los comandos disponibles del servidor")    
].map(command => command.toJSON());

// ============================================================
// REGISTRAR COMANDOS
// ============================================================

async function registerCommands() {
    const rest = new REST({
        version: "10"
    }).setToken(DISCORD_TOKEN);

    console.log("Registrando comandos de Discord...");

    await rest.put(
        Routes.applicationGuildCommands(
            CLIENT_ID,
            GUILD_ID
        ),
        {
            body: commands
        }
    );

    console.log("Comandos registrados correctamente.");
}

// ============================================================
// UTILIDADES
// ============================================================

/**
 * Comprueba si algo está escuchando en el puerto de Minecraft.
 *
 * Esto no consulta Azure.
 * Comprueba directamente si Paper ya está accesible.
 */
function isMinecraftOnline() {
    return new Promise(resolve => {
        const socket = new net.Socket();

        let finished = false;

        const finish = result => {
            if (finished) {
                return;
            }

            finished = true;

            socket.destroy();

            resolve(result);
        };

        socket.setTimeout(3000);

        socket.connect(
            MINECRAFT_PORT,
            MINECRAFT_HOST,
            () => finish(true)
        );

        socket.on(
            "timeout",
            () => finish(false)
        );

        socket.on(
            "error",
            () => finish(false)
        );
    });
}

/**
 * Espera hasta que Minecraft esté online.
 */
async function waitForMinecraftOnline(timeout = START_TIMEOUT_MS) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        const online = await isMinecraftOnline();

        if (online) {
            return true;
        }

        await sleep(CHECK_INTERVAL_MS);
    }

    return false;
}

/**
 * Espera hasta que Minecraft deje de responder.
 */
async function waitForMinecraftOffline(timeout = 90000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        const online = await isMinecraftOnline();

        if (!online) {
            return true;
        }

        await sleep(CHECK_INTERVAL_MS);
    }

    return false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ejecuta un webhook de Azure Automation.
 *
 * Azure Automation usa POST para iniciar el runbook.
 */
async function callWebhook(url) {
    if (!url) {
        throw new Error("Webhook no configurado.");
    }

    return axios.post(
        url,
        {},
        {
            timeout: 15000,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}

// ============================================================
// READY
// ============================================================

client.once(
    Events.ClientReady,
    readyClient => {
        console.log(
            `Bot conectado como ${readyClient.user.tag}`
        );
    }
);

// ============================================================
// INTERACCIONES
// ============================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        // ====================================================
        // BOTONES
        // ====================================================

        if (interaction.isButton()) {

            // ------------------------------------------------
            // CONFIRMAR RESTART
            // ------------------------------------------------

            if (
                interaction.customId.startsWith(
                    "restart-confirm:"
                )
            ) {
                const userId =
                    interaction.customId.split(":")[1];

                // Solamente quien ejecutó /restart puede confirmar.
                if (interaction.user.id !== userId) {
                    await interaction.reply({
                        content:
                            "❌ Solo quien ejecutó `/restart` puede confirmar esta acción.",
                        ephemeral: true
                    });

                    return;
                }

                await interaction.update({
                    content:
                        "🔄 **Reiniciando el mundo...**\n\n" +
                        "💾 Deteniendo Minecraft...\n" +
                        "🗑️ Eliminando el mundo actual...\n" +
                        "🌎 Preparando un mundo Hardcore nuevo...",
                    components: []
                });

                try {
                    console.log(
                        `[DiscordBot] ${interaction.user.tag} confirmó /restart`
                    );

                    await callWebhook(
                        WEBHOOK_RESTART
                    );

                    /*
                     * Primero esperamos a que Paper desaparezca.
                     *
                     * El runbook:
                     * systemctl stop
                     * reset-world.sh --force
                     * systemctl start
                     */

                    await waitForMinecraftOffline(
                        90000
                    );

                    const online =
                        await waitForMinecraftOnline(
                            START_TIMEOUT_MS
                        );

                    if (online) {
                        await interaction.editReply({
                            content:
                                "✅ **Nuevo mundo listo.**\n\n" +
                                "🌎 Se generó un nuevo mundo Hardcore.\n" +
                                `🎮 \`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``
                        });
                    } else {
                        await interaction.editReply({
                            content:
                                "⚠️ Azure aceptó el reinicio, pero Minecraft todavía no responde.\n\n" +
                                "Puede seguir generando el nuevo mundo. Prueba `/status` en unos segundos."
                        });
                    }

                } catch (error) {
                    console.error(
                        "Error en /restart:",
                        error.message
                    );

                    await interaction.editReply({
                        content:
                            "❌ Ocurrió un error al ejecutar el reinicio."
                    });
                }

                return;
            }

            // ------------------------------------------------
            // CANCELAR RESTART
            // ------------------------------------------------

            if (
                interaction.customId.startsWith(
                    "restart-cancel:"
                )
            ) {
                const userId =
                    interaction.customId.split(":")[1];

                if (interaction.user.id !== userId) {
                    await interaction.reply({
                        content:
                            "❌ Solo quien ejecutó `/restart` puede cancelar esta acción.",
                        ephemeral: true
                    });

                    return;
                }

                await interaction.update({
                    content:
                        "🟢 Reinicio cancelado. El mundo no fue modificado.",
                    components: []
                });

                return;
            }

            return;
        }

        // ====================================================
        // SLASH COMMANDS
        // ====================================================

        if (!interaction.isChatInputCommand()) {
            return;
        }

        // ----------------------------------------------------
        // /START
        // ----------------------------------------------------
        if (interaction.commandName === "comandos") {

    await interaction.reply(
        "📘 **Comandos del servidor de Minecraft**\n\n" +

        "🟢 **/start**\n" +
        "Enciende la máquina virtual de Azure y espera hasta que Minecraft esté listo.\n\n" +

        "🔴 **/stop**\n" +
        "Guarda el mundo correctamente y apaga/desasigna la máquina virtual para ahorrar créditos.\n\n" +

        "📊 **/status**\n" +
        "Comprueba si el servidor de Minecraft está disponible.\n\n" +

        "🔄 **/restart**\n" +
        "Elimina el mundo actual y genera uno nuevo en Hardcore.\n" +
        "⚠️ Este comando pide confirmación antes de borrar nada.\n\n" +

        "📘 **/comandos**\n" +
        "Muestra esta lista de comandos."
    );

    return;
}
        if (interaction.commandName === "start") {

            await interaction.deferReply();

            try {

                const alreadyOnline =
                    await isMinecraftOnline();

                if (alreadyOnline) {
                    await interaction.editReply(
                        "🟢 ** @here Minecraft ya está encendido.**\n\n" +
                        `🎮 \`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``
                    );

                    return;
                }

                await interaction.editReply(
                    "🟡 **Encendiendo servidor...**\n\n" +
                    "☁️ Iniciando máquina virtual de Azure..."
                );

                console.log(
                    `[DiscordBot] ${interaction.user.tag} ejecutó /start`
                );

                await callWebhook(
                    WEBHOOK_START
                );

                const startTime = Date.now();

                const online =
                    await waitForMinecraftOnline();

                if (!online) {
                    await interaction.editReply(
                        "⚠️ Azure recibió la orden de encendido, " +
                        "pero Minecraft todavía no responde después de 3 minutos.\n\n" +
                        "Usa `/status` para comprobarlo."
                    );

                    return;
                }

                const seconds =
                    Math.round(
                        (Date.now() - startTime) / 1000
                    );

                await interaction.editReply(
                    "🟢 **Servidor listo para jugar.**\n\n" +
                    `🎮 \`${MINECRAFT_HOST}:${MINECRAFT_PORT}\`\n` +
                    `⏱️ Tiempo de inicio: **${seconds}s**`
                );

            } catch (error) {

                console.error(
                    "Error en /start:",
                    error.message
                );

                await interaction.editReply(
                    "❌ No pude iniciar el servidor.\n" +
                    "Revisa Azure Automation."
                );
            }

            return;
        }

        // ----------------------------------------------------
        // /STOP
        // ----------------------------------------------------

        if (interaction.commandName === "stop") {

            await interaction.deferReply();

            try {

                await interaction.editReply(
                    "🔴 **Apagando servidor...**\n\n" +
                    "💾 Guardando el mundo...\n" +
                    "☁️ La VM será desasignada después."
                );

                console.log(
                    `[DiscordBot] ${interaction.user.tag} ejecutó /stop`
                );

                await callWebhook(
                    WEBHOOK_STOP
                );

                const offline =
                    await waitForMinecraftOffline(
                        120000
                    );

                if (offline) {
                    await interaction.editReply(
                        "✅ **Minecraft apagado.**\n\n" +
                        "☁️ Azure está terminando de desasignar la VM.\n" +
                        "💰 El cómputo dejará de cobrarse cuando quede `deallocated`."
                    );
                } else {
                    await interaction.editReply(
                        "⚠️ Azure recibió la orden, " +
                        "pero Minecraft todavía responde.\n\n" +
                        "Comprueba nuevamente con `/status`."
                    );
                }

            } catch (error) {

                console.error(
                    "Error en /stop:",
                    error.message
                );

                await interaction.editReply(
                    "❌ No pude enviar la orden de apagado."
                );
            }

            return;
        }

        // ----------------------------------------------------
        // /STATUS
        // ----------------------------------------------------

        if (interaction.commandName === "status") {

            await interaction.deferReply();

            const online =
                await isMinecraftOnline();

            if (online) {
                await interaction.editReply(
                    "🟢 **Minecraft Online**\n\n" +
                    "🎮 Estado: Listo para jugar\n" +
                    `🌐 \`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``
                );
            } else {
                await interaction.editReply(
                    "🔴 **Minecraft Offline**\n\n" +
                    "El puerto 25565 no está respondiendo.\n" +
                    "Usa `/start` para encenderlo."
                );
            }

            return;
        }

        // ----------------------------------------------------
        // /RESTART
        // ----------------------------------------------------

        if (interaction.commandName === "restart") {

            const confirmButton =
                new ButtonBuilder()
                    .setCustomId(
                        `restart-confirm:${interaction.user.id}`
                    )
                    .setLabel("Confirmar reset")
                    .setStyle(
                        ButtonStyle.Danger
                    );

            const cancelButton =
                new ButtonBuilder()
                    .setCustomId(
                        `restart-cancel:${interaction.user.id}`
                    )
                    .setLabel("Cancelar")
                    .setStyle(
                        ButtonStyle.Secondary
                    );

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        confirmButton,
                        cancelButton
                    );

            await interaction.reply({
                content:
                    "⚠️ **RESET COMPLETO DEL MUNDO**\n\n" +
                    "Esto eliminará permanentemente:\n" +
                    "• Overworld\n" +
                    "• Nether\n" +
                    "• End\n" +
                    "• Inventarios\n" +
                    "• Construcciones\n" +
                    "• Progreso de todos los jugadores\n\n" +
                    "**Esta acción no se puede deshacer.**",
                components: [
                    row
                ]
            });

            return;
        }
    }
);

// ============================================================
// INICIO
// ============================================================

async function main() {
    try {
        await registerCommands();

        await client.login(
            DISCORD_TOKEN
        );
    } catch (error) {
        console.error(
            "Error iniciando el bot:",
            error
        );

        process.exit(1);
    }
}
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });

    res.end("Minecraft Discord Bot is running.");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP server running on port ${PORT}`);
});
main();