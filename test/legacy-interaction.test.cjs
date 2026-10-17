const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');
const projectRequire = createRequire('C:/Users/Jhandel/Desktop/jhandel/botdiscord minecraft/package.json');
const discord = projectRequire('discord.js');

// Todo el tráfico y las credenciales se sustituyen por dobles de prueba.
function loadBot() {
    let client, httpHandler;
    let ready = true;
    const probes = [], webhooks = [], logs = [];
    class Client extends EventEmitter {
        constructor() { super(); client = this; }
        isReady() { return ready; }
        async login() {}
    }
    class REST { setToken() { return this; } async put() {} }
    class Socket extends EventEmitter {
        setTimeout() {}
        destroy() {}
        connect(port, host, success) {
            const online = probes.length ? probes.shift() : true;
            queueMicrotask(() => online ? success() : this.emit('error', new Error('offline')));
        }
    }
    const modules = {
        './dual-mode': { createDualMode: () => null },
        './paper-versions': { createVersionCatalog: () => async () => [] },
        http: { createServer(handler) { httpHandler = handler; return { listen() {} }; } },
        dotenv: { config() {} },
        'discord.js': { ...discord, Client, REST },
        axios: {
            async get() { return { data: { username: 'test-bot' } }; },
            async post(url) { webhooks.push(url); return { status: 202 }; }
        },
        net: { Socket }
    };
    vm.runInNewContext(fs.readFileSync(__dirname + '/../index.js', 'utf8'), {
        require(name) { if (!(name in modules)) throw new Error('Unexpected module: ' + name); return modules[name]; },
        process: { env: {
            DISCORD_TOKEN: 'dummy', DISCORD_CLIENT_ID: 'dummy', DISCORD_GUILD_IDS: '123',
            WEBHOOK_START: 'test-start', WEBHOOK_STOP: 'test-stop', WEBHOOK_RESTART: 'test-restart',
            MINECRAFT_HOST: 'test-host', PORT: '10000'
        } },
        console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(args)])),
        Date, setTimeout
    }, { filename: 'index.js' });
    return {
        client, probes, webhooks, logs,
        handle: interaction => client.listeners(discord.Events.InteractionCreate)[0](interaction),
        health(url, connected) {
            ready = connected;
            const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
            httpHandler({ url }, response);
            return response;
        }
    };
}

function interaction(commandName, failureMethod, code = 10062) {
    const calls = [];
    const item = {
        commandName, createdTimestamp: Date.now(), deferred: false, replied: false,
        user: { id: 'user', tag: 'test-user' }, calls,
        isChatInputCommand() { return !!commandName; },
        isButton() { return !commandName; },
        isModalSubmit() { return false; },
        isStringSelectMenu() { return false; }
    };
    for (const method of ['deferReply', 'reply', 'update', 'editReply']) {
        item[method] = async function(payload) {
            calls.push({ method, payload });
            if (method === failureMethod) throw Object.assign(new Error('simulated failure'), { code });
            if (method === 'deferReply') item.deferred = true;
            if (method === 'reply' || method === 'update') item.replied = true;
        };
    }
    return item;
}

for (const command of ['start', 'stop', 'status']) {
    test(`/${command}: expired defer is contained; no Azure action or reply retry`, async () => {
        const bot = loadBot();
        const request = interaction(command, 'deferReply');
        request.createdTimestamp -= 5000;
        await bot.handle(request);
        assert.deepEqual(request.calls.map(c => c.method), ['deferReply']);
        assert.equal(bot.webhooks.length, 0);
        assert.ok(bot.logs.some(args => String(args[0]).includes('falló; edad=')));
        const next = interaction('status');
        await bot.handle(next);
        assert.equal(next.calls[1].method, 'editReply');
    });
}

test('acknowledgement by another instance is contained', async () => {
    const bot = loadBot();
    const request = interaction('start', 'deferReply', 40060);
    await bot.handle(request);
    assert.equal(request.calls.length, 1);
    assert.equal(bot.webhooks.length, 0);
});

test('/status reports online and offline after acknowledgement', async () => {
    const bot = loadBot();
    for (const online of [true, false]) {
        bot.probes.push(online);
        const request = interaction('status');
        await bot.handle(request);
        assert.deepEqual(request.calls.map(c => c.method), ['deferReply', 'editReply']);
        assert.match(request.calls[1].payload, online ? /Minecraft Online/ : /Minecraft Offline/);
    }
});

test('/start and /stop preserve webhook flows with fake network only', async () => {
    const bot = loadBot();
    bot.probes.push(false, true);
    const start = interaction('start');
    await bot.handle(start);
    assert.match(start.calls.at(-1).payload, /Servidor listo/);
    bot.probes.push(false);
    const stop = interaction('stop');
    await bot.handle(stop);
    assert.match(stop.calls.at(-1).payload, /Minecraft apagado/);
    assert.deepEqual(bot.webhooks, ['test-start', 'test-stop']);
});

test('restart still requires confirmation; expired button never invokes reset', async () => {
    const bot = loadBot();
    const prompt = interaction('restart');
    await bot.handle(prompt);
    assert.equal(prompt.calls[0].payload.components.length, 1);
    assert.equal(bot.webhooks.length, 0);
    const button = interaction(null, 'update');
    button.customId = 'restart-confirm:user';
    await bot.handle(button);
    assert.equal(bot.webhooks.length, 0);
    assert.equal(button.calls.length, 1);
});

test('expired help reply is contained', async () => {
    const bot = loadBot();
    await bot.handle(interaction('comandos', 'reply'));
});

test('edit failure and failed error notification do not escape the handler', async () => {
    const bot = loadBot();
    await bot.handle(interaction('status', 'editReply', 50013));
    assert.ok(bot.logs.some(args => String(args[0]).includes('No se pudo enviar')));
});

test('Client error has a listener; Gateway lifecycle is logged', () => {
    const bot = loadBot();
    assert.doesNotThrow(() => bot.client.emit(discord.Events.Error, Object.assign(new Error('test'), { code: 'TEST' })));
    bot.client.emit(discord.Events.ShardDisconnect, { code: 1006 }, 0);
    bot.client.emit(discord.Events.ShardReconnecting, 0);
    bot.client.emit(discord.Events.ShardResume, 0, 2);
    assert.ok(bot.logs.some(args => String(args[0]).includes('Sesión recuperada')));
});

test('HTTP root and healthz report Discord readiness instead of unconditional success', () => {
    const bot = loadBot();
    for (const ready of [true, false]) {
        const health = bot.health('/healthz?monitor=1', ready);
        assert.equal(health.status, ready ? 200 : 503);
        assert.equal(JSON.parse(health.body).discordReady, ready);
        assert.equal(health.headers['Cache-Control'], 'no-store');
        assert.equal(bot.health('/', ready).status, ready ? 200 : 503);
    }
});
