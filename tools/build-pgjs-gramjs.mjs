import { build } from "esbuild";

function parseApiId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBoolean(value) {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

const runtimeConfig = {
  apiId: parseApiId(process.env.PGJS_TELEGRAM_API_ID),
  apiHash: String(process.env.PGJS_TELEGRAM_API_HASH || "").trim(),
  forceWSS: parseBoolean(process.env.PGJS_TELEGRAM_FORCE_WSS),
  testServers: parseBoolean(process.env.PGJS_TELEGRAM_TEST_SERVERS)
};

await build({
  entryPoints: ["tools/pgjs-gramjs-entry.js"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2015",
  outfile: "src/pkjs/pgjs/gramjs.bundle.js",
  logLevel: "info",
  define: {
    __PGJS_BUILTIN_CONFIG__: JSON.stringify(runtimeConfig)
  },
  alias: {
    crypto: "./src/pkjs/pgjs/shims/crypto.js",
    fs: "./src/pkjs/pgjs/shims/empty.js",
    net: "./src/pkjs/pgjs/shims/empty.js",
    tls: "./src/pkjs/pgjs/shims/empty.js",
    events: "./src/pkjs/pgjs/shims/events.js",
    util: "./src/pkjs/pgjs/shims/util.js",
    path: "./src/pkjs/pgjs/shims/path.js",
    stream: "./src/pkjs/pgjs/shims/stream.js",
    os: "./src/pkjs/pgjs/shims/os.js",
    assert: "./src/pkjs/pgjs/shims/empty.js",
    constants: "./src/pkjs/pgjs/shims/empty.js",
    socks: "./src/pkjs/pgjs/shims/empty.js",
    websocket: "./src/pkjs/pgjs/shims/websocket.js"
  }
});
