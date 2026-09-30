import { build } from "esbuild";

function parseApiId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const runtimeConfig = {
  apiId: parseApiId(process.env.PGJS_TELEGRAM_API_ID),
  apiHash: String(process.env.PGJS_TELEGRAM_API_HASH || "").trim(),
  // Encrypted wss:// is the default: the Core Devices phone apps block cleartext
  // ws:// sockets (issues #4, #7). Set PGJS_TELEGRAM_FORCE_WSS=false to opt out.
  forceWSS: parseBoolean(process.env.PGJS_TELEGRAM_FORCE_WSS, true),
  testServers: parseBoolean(process.env.PGJS_TELEGRAM_TEST_SERVERS)
};

const commonOptions = {
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2015",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
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
};

await build({
  ...commonOptions,
  entryPoints: ["tools/pgjs-gramjs-entry.js"],
  outfile: "src/pkjs/pgjs/gramjs.bundle.js",
  define: {
    __PGJS_BUILTIN_CONFIG__: JSON.stringify(runtimeConfig)
  }
});

await build({
  ...commonOptions,
  entryPoints: ["tools/pgjs-codecs-entry.js"],
  outfile: "src/pkjs/pgjs/codecs.bundle.js"
});
