const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

async function main() {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
        throw new Error("Ejecuta este script en una terminal interactiva.");
    }
    process.stdout.write("Palabra clave (no se mostrará): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const password = await new Promise((resolve, reject) => {
        let value = "";
        process.stdin.on("data", chunk => {
            const text = chunk.toString("utf8");
            for (const character of text) {
                if (character === "\u0003") {
                    reject(new Error("Cancelado."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    process.stdout.write("\n");
                    resolve(value);
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    value = value.slice(0, -1);
                } else {
                    value += character;
                }
            }
        });
    });
    process.stdin.setRawMode(false);
    process.stdin.pause();
    if (password.length < 12) {
        throw new Error("Usa al menos 12 caracteres para dificultar intentos de adivinarla.");
    }
    const salt = crypto.randomBytes(16);
    const digest = await scrypt(password, salt, 32);
    process.stdout.write("Copia este hash a Render (nunca la palabra clave):\n");
    process.stdout.write("scrypt$" + salt.toString("hex") + "$" + digest.toString("hex") + "\n");
}

main().catch(error => {
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdin.pause();
    console.error(error.message);
    process.exitCode = 1;
});
