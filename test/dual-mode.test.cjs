const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createDualMode, readConfiguration, verifyPassword } = require("../dual-mode");

function hash(value) {
    const salt = Buffer.alloc(16, 7);
    return "scrypt$" + salt.toString("hex") + "$" +
        crypto.scryptSync(value, salt, 32).toString("hex");
}

function environment() {
    return {
        DISCORD_GUILD_IDS: "987654321098765432",
        MINECRAFT_HOST: "example.invalid",
        MINECRAFT_PORT_COLEGIO: "25565",
        MINECRAFT_PORT_UNIVERSIDAD: "25566",
        WEBHOOK_VM_START: "https://example.invalid/vm",
        WEBHOOK_COLEGIO_START: "https://example.invalid/c/start",
        WEBHOOK_COLEGIO_STOP: "https://example.invalid/c/stop",
        WEBHOOK_COLEGIO_RESTART: "https://example.invalid/c/reset",
        WEBHOOK_COLEGIO_VERSION: "https://example.invalid/c/version",
        WEBHOOK_UNIVERSIDAD_START: "https://example.invalid/u/start",
        WEBHOOK_UNIVERSIDAD_STOP: "https://example.invalid/u/stop",
        WEBHOOK_UNIVERSIDAD_RESTART: "https://example.invalid/u/reset",
        WEBHOOK_UNIVERSIDAD_VERSION: "https://example.invalid/u/version",
        WORLD_COLEGIO_PASSWORD_HASH: hash("frase-colegio-segura"),
        WORLD_UNIVERSIDAD_PASSWORD_HASH: hash("frase-universidad-segura")
    };
}

function fakeInteraction(type, fields = {}) {
    const output = { replies: [], edits: [], updates: [], modals: [] };
    const interaction = {
        user: { id: fields.userId || "123456789012345678" },
        guildId: "987654321098765432",
        commandName: fields.commandName,
        customId: fields.customId,
        values: fields.values,
        fields: { getTextInputValue: () => fields.password },
        isChatInputCommand: () => type === "command",
        isButton: () => type === "button",
        isModalSubmit: () => type === "modal",
        isStringSelectMenu: () => type === "select",
        deferReply: async () => {},
        reply: async value => output.replies.push(value),
        editReply: async value => output.edits.push(value),
        update: async value => output.updates.push(value),
        showModal: async value => output.modals.push(value)
    };
    return { interaction, output };
}

function customIdFromRow(row, index = 0) {
    return row.components[index].toJSON().custom_id;
}

test("la configuración dual falla si falta una clave o los puertos coinciden", () => {
    const env = environment();
    delete env.WORLD_UNIVERSIDAD_PASSWORD_HASH;
    assert.throws(() => readConfiguration(env), /WORLD_UNIVERSIDAD_PASSWORD_HASH/);
    env.WORLD_UNIVERSIDAD_PASSWORD_HASH = hash("otra-frase-segura");
    env.MINECRAFT_PORT_UNIVERSIDAD = "25565";
    assert.throws(() => readConfiguration(env), /puertos diferentes/);
});

test("la palabra clave correcta se verifica y la incorrecta se rechaza", async () => {
    assert.equal(await verifyPassword("frase-colegio-segura", hash("frase-colegio-segura")), true);
    assert.equal(await verifyPassword("otra-frase", hash("frase-colegio-segura")), false);
});

test("/start enciende la VM y solo inicia el mundo tras elegirlo y dar la clave", async () => {
    const calls = [];
    const dual = createDualMode(environment(), {
        callWebhook: async url => calls.push(url),
        isOnline: async () => false,
        waitOnline: async () => true,
        waitOffline: async () => true
    });
    const start = fakeInteraction("command", { commandName: "start" });
    await dual.handle(start.interaction);
    assert.deepEqual(calls, ["https://example.invalid/vm"]);
    const selection = start.output.edits.at(-1);
    const chooseId = customIdFromRow(selection.components[0], 1);
    const choose = fakeInteraction("button", { customId: chooseId });
    await dual.handle(choose.interaction);
    assert.equal(choose.output.modals.length, 1);
    const passwordId = choose.output.modals[0].toJSON().custom_id;
    const wrong = fakeInteraction("modal", { customId: passwordId, password: "incorrecta" });
    await dual.handle(wrong.interaction);
    assert.deepEqual(calls, ["https://example.invalid/vm"]);
    const correct = fakeInteraction("modal", { customId: passwordId, password: "frase-universidad-segura" });
    await dual.handle(correct.interaction);
    assert.deepEqual(calls, ["https://example.invalid/vm", "https://example.invalid/u/start"]);
});

test("/restart requiere clave, confirmación del solicitante y no toca el otro mundo", async () => {
    const calls = [];
    const dual = createDualMode(environment(), {
        callWebhook: async url => calls.push(url),
        isOnline: async () => false,
        waitOnline: async () => true,
        waitOffline: async () => true
    });
    const restart = fakeInteraction("command", { commandName: "restart" });
    await dual.handle(restart.interaction);
    const chooseId = customIdFromRow(restart.output.replies[0].components[0], 0);
    const choose = fakeInteraction("button", { customId: chooseId });
    await dual.handle(choose.interaction);
    const passwordId = choose.output.modals[0].toJSON().custom_id;
    const correct = fakeInteraction("modal", { customId: passwordId, password: "frase-colegio-segura" });
    await dual.handle(correct.interaction);
    assert.deepEqual(calls, []);
    const confirmation = correct.output.edits.at(-1);
    const confirmId = customIdFromRow(confirmation.components[0], 0);
    const outsider = fakeInteraction("button", { customId: confirmId, userId: "222222222222222222" });
    await dual.handle(outsider.interaction);
    assert.deepEqual(calls, []);
    const owner = fakeInteraction("button", { customId: confirmId });
    await dual.handle(owner.interaction);
    assert.deepEqual(calls, ["https://example.invalid/c/reset"]);
    const repeat = fakeInteraction("button", { customId: confirmId });
    await dual.handle(repeat.interaction);
    assert.deepEqual(calls, ["https://example.invalid/c/reset"]);
});

test("puede iniciar Universidad mientras Colegio está activo", async () => {
    const calls = [];
    const dual = createDualMode(environment(), {
        callWebhook: async url => calls.push(url),
        isOnline: async port => port === 25565,
        waitOnline: async () => true,
        waitOffline: async () => true
    });
    const start = fakeInteraction("command", { commandName: "start" });
    await dual.handle(start.interaction);
    const chooseId = customIdFromRow(start.output.edits.at(-1).components[0], 1);
    const choose = fakeInteraction("button", { customId: chooseId });
    await dual.handle(choose.interaction);
    const modalId = choose.output.modals[0].toJSON().custom_id;
    const password = fakeInteraction("modal", { customId: modalId, password: "frase-universidad-segura" });
    await dual.handle(password.interaction);
    assert.deepEqual(calls, ["https://example.invalid/vm", "https://example.invalid/u/start"]);
});

test("bloquea los intentos repetidos de adivinar una palabra clave", async () => {
    const calls = [];
    const dual = createDualMode(environment(), {
        callWebhook: async url => calls.push(url),
        isOnline: async () => false,
        waitOnline: async () => true,
        waitOffline: async () => true
    });
    const stop = fakeInteraction("command", { commandName: "stop" });
    await dual.handle(stop.interaction);
    const chooseId = customIdFromRow(stop.output.replies[0].components[0], 0);
    const choose = fakeInteraction("button", { customId: chooseId });
    await dual.handle(choose.interaction);
    const modalId = choose.output.modals[0].toJSON().custom_id;
    for (let i = 0; i < 5; i++) {
        await dual.handle(fakeInteraction("modal", { customId: modalId, password: "incorrecta" }).interaction);
    }
    const correct = fakeInteraction("modal", { customId: modalId, password: "frase-colegio-segura" });
    await dual.handle(correct.interaction);
    assert.deepEqual(calls, []);
    assert.match(correct.output.edits.at(-1), /Demasiados intentos/);
});

test("/version requiere clave y confirmación; envía solo versión y modo del mundo elegido", async () => {
    const calls = [];
    const dual = createDualMode(environment(), {
        callWebhook: async (url, body) => calls.push({ url, body }),
        getVersions: async () => ["26.3", "26.2", "26.1.2"],
        isOnline: async () => false
    });
    const command = fakeInteraction("command", { commandName: "version" });
    await dual.handle(command.interaction);
    const chooseId = customIdFromRow(command.output.replies[0].components[0], 1);
    const choose = fakeInteraction("button", { customId: chooseId });
    await dual.handle(choose.interaction);
    const passwordId = choose.output.modals[0].toJSON().custom_id;
    const auth = fakeInteraction("modal", { customId: passwordId, password: "frase-universidad-segura" });
    await dual.handle(auth.interaction);
    const menuId = customIdFromRow(auth.output.edits.at(-1).components[0]);
    const select = fakeInteraction("select", { customId: menuId, values: ["26.2"] });
    await dual.handle(select.interaction);
    const preserveId = customIdFromRow(select.output.updates[0].components[0]);
    const mode = fakeInteraction("button", { customId: preserveId });
    await dual.handle(mode.interaction);
    const confirmId = customIdFromRow(mode.output.updates[0].components[0]);
    const outsider = fakeInteraction("button", { customId: confirmId, userId: "222222222222222222" });
    await dual.handle(outsider.interaction);
    assert.deepEqual(calls, []);
    const confirm = fakeInteraction("button", { customId: confirmId });
    await dual.handle(confirm.interaction);
    assert.deepEqual(calls, [{
        url: "https://example.invalid/u/version", body: { version: "26.2", mode: "preserve" }
    }]);
    const replay = fakeInteraction("button", { customId: confirmId });
    await dual.handle(replay.interaction);
    assert.equal(calls.length, 1);
});
