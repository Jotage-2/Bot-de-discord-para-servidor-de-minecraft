const PROJECT_URL = "https://fill.papermc.io/v3/projects/paper";
const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const USER_AGENT = "MinecraftDualWorldBot/1.0 (https://github.com/Jotage-2/Bot-de-discord-para-servidor-de-minecraft)";
const VERSION = /^\d+(?:\.\d+){1,2}$/;
const CACHE_MS = 5 * 60 * 1000;

async function getJson(url, request = fetch) {
    const response = await request(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`El catálogo de versiones respondió ${response.status}.`);
    return response.json();
}

function compareVersions(a, b) {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] || 0) - (right[i] || 0);
        if (difference) return difference;
    }
    return 0;
}

function stableBuild(builds) {
    if (!Array.isArray(builds)) return null;
    return builds
        .filter(build => build.channel === "STABLE" &&
            build.downloads?.["server:default"]?.checksums?.sha256 &&
            build.downloads?.["server:default"]?.url)
        .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
}

function createVersionCatalog(request = fetch) {
    let cached = null;
    let expiresAt = 0;
    let pending = null;

    async function load() {
        const [paper, mojang] = await Promise.all([
            getJson(PROJECT_URL, request),
            getJson(MANIFEST_URL, request)
        ]);
        const released = new Set((mojang.versions || [])
            .filter(item => item.type === "release" && VERSION.test(item.id))
            .map(item => item.id));
        const candidates = [...new Set(Object.values(paper.versions || {}).flat())]
            .filter(version => VERSION.test(version) && released.has(version))
            .sort((a, b) => compareVersions(b, a));
        const versions = [];
        for (const version of candidates) {
            const builds = await getJson(`${PROJECT_URL}/versions/${version}/builds`, request);
            if (stableBuild(builds)) versions.push(version);
            if (versions.length === 3) break;
        }
        if (!versions.length) throw new Error("No hay versiones oficiales con Paper estable disponibles.");
        return versions;
    }

    return async function recentStableVersions() {
        if (cached && Date.now() < expiresAt) return [...cached];
        if (!pending) {
            pending = load().then(versions => {
                cached = versions;
                expiresAt = Date.now() + CACHE_MS;
                return versions;
            }).finally(() => { pending = null; });
        }
        return [...await pending];
    };
}

module.exports = { createVersionCatalog, compareVersions, stableBuild };
