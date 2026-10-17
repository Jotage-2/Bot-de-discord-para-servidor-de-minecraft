const test = require("node:test");
const assert = require("node:assert/strict");
const { createVersionCatalog, compareVersions } = require("../paper-versions");

test("elige tres lanzamientos oficiales con Paper estable y excluye snapshots", async () => {
    const urls = [];
    const request = async url => {
        urls.push(url);
        if (url.includes("version_manifest")) {
            return { ok: true, json: async () => ({ versions: [
                { id: "26.4-snapshot-1", type: "snapshot" },
                { id: "26.3", type: "release" },
                { id: "26.2", type: "release" },
                { id: "26.1.2", type: "release" },
                { id: "26.1.1", type: "release" }
            ] }) };
        }
        if (url.endsWith("/projects/paper")) {
            return { ok: true, json: async () => ({ versions: {
                "26.4": ["26.4-snapshot-1"],
                "26.3": ["26.3", "26.3-rc-1"],
                "26.2": ["26.2"],
                "26.1": ["26.1.2", "26.1.1"]
            } }) };
        }
        const version = url.split("/").at(-2);
        const channel = version === "26.1.1" ? "BETA" : "STABLE";
        return { ok: true, json: async () => [{
            id: 1, channel,
            downloads: { "server:default": { url: "https://example.invalid/paper.jar", checksums: { sha256: "a".repeat(64) } } }
        }] };
    };
    const catalog = createVersionCatalog(request);
    assert.deepEqual(await catalog(), ["26.3", "26.2", "26.1.2"]);
    assert.deepEqual(await catalog(), ["26.3", "26.2", "26.1.2"]);
    assert.equal(urls.length, 5); // cached; no second request
});

test("ordena versiones numéricamente", () => {
    assert.ok(compareVersions("26.10", "26.3") > 0);
    assert.ok(compareVersions("26.1.2", "26.1.1") > 0);
});
