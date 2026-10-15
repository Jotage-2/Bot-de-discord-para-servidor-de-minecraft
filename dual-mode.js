const crypto = require("node:crypto");
const { promisify } = require("node:util");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

const scrypt = promisify(crypto.scrypt);
const WORLD_KEYS = ["colegio", "universidad"];
const LABELS = { colegio: "Colegio", universidad: "Universidad" };
const ACTIONS = ["start", "stop", "restart"];
const PENDING_TTL_MS = 5 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function parsePort(value, name) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(name + " debe ser un puerto TCP válido.");
    }
    return port;
}

function readConfiguration(env) {
    const required = [
        "WEBHOOK_COLEGIO_START",
        "WEBHOOK_COLEGIO_STOP",
        "WEBHOOK_COLEGIO_RESTART",
        "WEBHOOK_UNIVERSIDAD_START",
        "WEBHOOK_UNIVERSIDAD_STOP",
        "WEBHOOK_UNIVERSIDAD_RESTART",
        "WORLD_COLEGIO_PASSWORD_HASH",
        "WORLD_UNIVERSIDAD_PASSWORD_HASH",
        "MINECRAFT_PORT_COLEGIO",
        "MINECRAFT_PORT_UNIVERSIDAD",
        "DISCORD_GUILD_IDS",
        "MINECRAFT_HOST"
    ];
    const missing = required.filter(name => !env[name]);
    if (missing.length) {
        throw new Error("Faltan variables para WORLD_MODE=dual: " + missing.join(", "));
    }
    const worlds = {};
    for (const key of WORLD_KEYS) {
        const upper = key.toUpperCase();
        worlds[key] = {
            key,
            label: LABELS[key],
            port: parsePort(env["MINECRAFT_PORT_" + upper], "MINECRAFT_PORT_" + upper),
            passwordHash: env["WORLD_" + upper + "_PASSWORD_HASH"],
            webhooks: {
                start: env["WEBHOOK_" + upper + "_START"],
                stop: env["WEBHOOK_" + upper + "_STOP"],
                restart: env["WEBHOOK_" + upper + "_RESTART"]
            }
        };
        if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(worlds[key].passwordHash)) {
            throw new Error("WORLD_" + upper + "_PASSWORD_HASH tiene un formato inválido.");
        }
    }
    if (worlds.colegio.port === worlds.universidad.port) {
        throw new Error("Los dos mundos deben usar puertos diferentes.");
    }
    const guildIds = new Set(env.DISCORD_GUILD_IDS.split(",").map(id => id.trim()).filter(Boolean));
    if (!guildIds.size || [...guildIds].some(id => !/^\d+$/.test(id))) {
        throw new Error("DISCORD_GUILD_IDS debe contener IDs de servidores de Discord.");
    }
    const vmStartWebhook = env.WEBHOOK_VM_START || env.WEBHOOK_START;
    if (!vmStartWebhook) {
        throw new Error("Falta WEBHOOK_VM_START o el WEBHOOK_START existente.");
    }
    return { host: env.MINECRAFT_HOST, vmStartWebhook, worlds, guildIds };
}

async function verifyPassword(input, encoded) {
    const [, saltHex, hashHex] = encoded.split("$");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(input, Buffer.from(saltHex, "hex"), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

function commandDefinitions() {
    return [
        new SlashCommandBuilder().setName("start").setDescription("Enciende la VM y te deja elegir qué mundo iniciar"),
        new SlashCommandBuilder().setName("stop").setDescription("Detiene el mundo que elijas; conserva el otro"),
        new SlashCommandBuilder().setName("status").setDescription("Muestra el estado de ambos mundos"),
        new SlashCommandBuilder().setName("restart").setDescription("Borra y regenera el mundo que elijas, tras verificar su clave"),
        new SlashCommandBuilder().setName("comandos").setDescription("Muestra los comandos disponibles")
    ].map(command => command.toJSON());
}

function parseCustomId(customId, kind) {
    const parts = customId.split(":");
    if (parts.length !== 6 || parts[0] !== "dual" || parts[1] !== kind) return null;
    const [, , action, world, userId, issuedAt] = parts;
    if (!ACTIONS.includes(action) || !WORLD_KEYS.includes(world) || !/^\d+$/.test(userId)) return null;
    const issued = Number(issuedAt);
    if (!Number.isSafeInteger(issued) || issued > Date.now() || Date.now() - issued > PENDING_TTL_MS) return null;
    return { action, world, userId, issued };
}

function createDualMode(env, api) {
    const config = readConfiguration(env);
    const pendingResets = new Map();
    const failedAttempts = new Map();
    let operationBusy = false;

    function isLockedOut(userId) {
        const item = failedAttempts.get(userId);
        if (!item || Date.now() - item.startedAt > ATTEMPT_WINDOW_MS) {
            failedAttempts.delete(userId);
            return false;
        }
        return item.count >= MAX_ATTEMPTS;
    }

    function recordFailure(userId) {
        const item = failedAttempts.get(userId);
        if (!item || Date.now() - item.startedAt > ATTEMPT_WINDOW_MS) {
            failedAttempts.set(userId, { count: 1, startedAt: Date.now() });
        } else {
            item.count++;
        }
    }

    async function online(worldKey) {
        return api.isOnline(config.worlds[worldKey].port);
    }

    function selectionButtons(action, userId) {
        const issued = Date.now();
        const buttons = WORLD_KEYS.map(key =>
            new ButtonBuilder()
                .setCustomId(["dual", "choose", action, key, userId, issued].join(":"))
                .setLabel(LABELS[key])
                .setStyle(ButtonStyle.Primary)
        );
        return [new ActionRowBuilder().addComponents(...buttons)];
    }

    function passwordModal({ action, world, userId, issued }) {
        const modal = new ModalBuilder()
            .setCustomId(["dual", "password", action, world, userId, issued].join(":"))
            .setTitle("Clave de " + LABELS[world]);
        const field = new TextInputBuilder()
            .setCustomId("clave")
            .setLabel("Palabra clave de " + LABELS[world])
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(128)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(field));
        return modal;
    }

    async function showSelection(interaction, action) {
        const message = action === "restart"
            ? "⚠️ Elige el mundo que deseas BORRAR y regenerar."
            : "Elige el mundo de " + (action === "stop" ? "parar" : "iniciar") + ".";
        await interaction.reply({
            content: message,
            components: selectionButtons(action, interaction.user.id),
            ephemeral: true
        });
    }

    async function startVmAndSelect(interaction) {
        await interaction.deferReply({ ephemeral: true });
        if (operationBusy) {
            await interaction.editReply("⏳ Hay otra operación en curso. Intenta de nuevo más tarde.");
            return;
        }
        operationBusy = true;
        try {
            await api.callWebhook(config.vmStartWebhook);
        } finally {
            operationBusy = false;
        }
        await interaction.editReply({
            content: "☁️ Azure recibió la orden de encender la VM. Elige el mundo que quieres iniciar:",
            components: selectionButtons("start", interaction.user.id)
        });
    }

    async function showStatus(interaction) {
        await interaction.deferReply();
        const [colegio, universidad] = await Promise.all(WORLD_KEYS.map(online));
        const line = (key, active) => (active ? "🟢 " : "🔴 ") + LABELS[key] + ": " +
            (active ? "online en " + config.host + ":" + config.worlds[key].port : "offline");
        await interaction.editReply([
            "**Estado de los mundos**",
            line("colegio", colegio),
            line("universidad", universidad)
        ].join("\n"));
    }

    async function performAction(interaction, action, worldKey) {
        if (operationBusy) {
            await interaction.editReply("⏳ Hay otra operación en curso. Intenta de nuevo más tarde.");
            return;
        }
        operationBusy = true;
        try {
            if (action === "start" && await online(worldKey)) {
                await interaction.editReply("🟢 " + LABELS[worldKey] + " ya está online en " +
                    config.host + ":" + config.worlds[worldKey].port);
                return;
            }
            await interaction.editReply("⏳ Azure recibió la orden para " + LABELS[worldKey] + "...");
            await api.callWebhook(config.worlds[worldKey].webhooks[action]);
            if (action === "stop") {
                const offline = await api.waitOffline(120000, config.worlds[worldKey].port);
                await interaction.editReply(offline
                    ? "✅ " + LABELS[worldKey] + " está apagado. El otro mundo no se modificó."
                    : "⚠️ Azure aceptó la orden, pero " + LABELS[worldKey] + " todavía responde. Consulta /status.");
            } else {
                if (action === "restart") {
                    await interaction.editReply("⚠️ Azure aceptó la orden de regeneración de " +
                        LABELS[worldKey] + ". Comprueba /status más tarde; la disponibilidad del puerto no confirma que el mundo ya se haya borrado.");
                    return;
                }
                const ready = await api.waitOnline(180000, config.worlds[worldKey].port);
                await interaction.editReply(ready
                    ? "✅ " + LABELS[worldKey] + " listo en " + config.host + ":" + config.worlds[worldKey].port
                    : "⚠️ Azure aceptó la orden, pero " + LABELS[worldKey] + " aún no responde. Consulta /status.");
            }
        } finally {
            operationBusy = false;
        }
    }

    async function handlePassword(interaction, parsed) {
        await interaction.deferReply({ ephemeral: true });
        if (interaction.user.id !== parsed.userId) {
            await interaction.editReply("❌ Solo quien inició la solicitud puede completar este formulario.");
            return;
        }
        if (isLockedOut(interaction.user.id)) {
            await interaction.editReply("⏳ Demasiados intentos. Espera 15 minutos.");
            return;
        }
        const password = interaction.fields.getTextInputValue("clave");
        if (!await verifyPassword(password, config.worlds[parsed.world].passwordHash)) {
            recordFailure(interaction.user.id);
            await interaction.editReply("❌ Palabra clave incorrecta.");
            return;
        }
        failedAttempts.delete(interaction.user.id);
        if (parsed.action !== "restart") {
            await performAction(interaction, parsed.action, parsed.world);
            return;
        }
        const nonce = crypto.randomUUID();
        pendingResets.set(nonce, {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            world: parsed.world,
            expiresAt: Date.now() + PENDING_TTL_MS
        });
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("dual:confirm:" + nonce).setLabel("Borrar " + LABELS[parsed.world]).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("dual:cancel:" + nonce).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({
            content: "⚠️ **Esto borrará y regenerará el mundo " + LABELS[parsed.world] +
                "**, incluidos construcciones, inventarios, Nether y End. El otro mundo no se tocará. ¿Confirmas?",
            components: [buttons]
        });
    }

    async function handleConfirmation(interaction) {
        const [, choice, nonce] = interaction.customId.split(":");
        const pending = pendingResets.get(nonce);
        if (!pending || pending.expiresAt < Date.now() ||
            pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
            await interaction.reply({ content: "❌ Confirmación vencida o no autorizada.", ephemeral: true });
            return;
        }
        pendingResets.delete(nonce);
        if (choice === "cancel") {
            await interaction.update({ content: "✅ Cancelado. Ningún mundo fue modificado.", components: [] });
            return;
        }
        if (choice !== "confirm") return;
        await interaction.update({
            content: "⚠️ Regenerando " + LABELS[pending.world] + ". Espera el resultado...",
            components: []
        });
        await performAction(interaction, "restart", pending.world);
    }

    async function handle(interaction) {
        if (!config.guildIds.has(interaction.guildId)) {
            return interaction.reply({ content: "❌ Este servidor de Discord no está autorizado.", ephemeral: true });
        }
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === "start") return startVmAndSelect(interaction);
            if (interaction.commandName === "status") return showStatus(interaction);
            if (interaction.commandName === "stop") return showSelection(interaction, "stop");
            if (interaction.commandName === "restart") return showSelection(interaction, "restart");
            if (interaction.commandName === "comandos") {
                return interaction.reply({
                    content: "Usa /start para encender la VM y elegir un mundo; /status para ver ambos; " +
                        "/stop para apagar uno; /restart para **borrar y regenerar** el mundo elegido. " +
                        "Las acciones de cada mundo requieren su palabra clave.",
                    ephemeral: true
                });
            }
            return;
        }
        if (interaction.isButton()) {
            if (interaction.customId.startsWith("dual:choose:")) {
                const parsed = parseCustomId(interaction.customId, "choose");
                if (!parsed || interaction.user.id !== parsed.userId) {
                    return interaction.reply({ content: "❌ Esta selección venció o pertenece a otra persona.", ephemeral: true });
                }
                return interaction.showModal(passwordModal(parsed));
            }
            if (interaction.customId.startsWith("dual:confirm:") || interaction.customId.startsWith("dual:cancel:")) {
                return handleConfirmation(interaction);
            }
            return;
        }
        if (interaction.isModalSubmit() && interaction.customId.startsWith("dual:password:")) {
            const parsed = parseCustomId(interaction.customId, "password");
            if (!parsed) return interaction.reply({ content: "❌ Este formulario venció.", ephemeral: true });
            return handlePassword(interaction, parsed);
        }
    }

    return { commands: commandDefinitions(), handle };
}

module.exports = { createDualMode, readConfiguration, verifyPassword };
