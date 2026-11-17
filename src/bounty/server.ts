import "dotenv/config";
import { config as loadEnv } from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BountyStore } from "./store.js";
import { bountyRoutes, type BountyOptions } from "./routes.js";

loadEnv({ path: ".env.local", override: false, quiet: true });

export async function buildBountyApp(
  options: BountyOptions & { dashboard?: string },
) {
  const app = Fastify({
    logger: true,
    bodyLimit: 1100000,
    requestTimeout: 150000,
  });
  app.addHook("onSend", async (_req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header("Cache-Control", "no-store");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });
  app.get("/healthz", async () => ({ ok: true, mode: "bounty" }));
  await app.register(bountyRoutes, { ...options, prefix: "/api" });
  if (options.dashboard && existsSync(join(options.dashboard, "index.html"))) {
    await app.register(fastifyStatic, {
      root: options.dashboard,
      wildcard: false,
    });
    // New hashed assets must be available after rebuilding the dashboard while this
    // personal server is running; the root plugin enumerates files only at startup.
    if (existsSync(join(options.dashboard, "assets"))) await app.register(fastifyStatic, {
      root: join(options.dashboard, "assets"), prefix: "/assets/", decorateReply: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method !== "GET" ||
        req.url === "/api" ||
        req.url.startsWith("/api/") ||
        req.url.includes(".")
      )
        return reply.code(404).send({ error: "Não encontrado." });
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async (_req, reply) =>
      reply
        .type("text/plain")
        .send(
          "Ghosthunt Bug Bounty. Execute npm run web:build para disponibilizar o painel.",
        ),
    );
  }
  return app;
}

async function start() {
  const directory = resolve(process.env.GHOSTHUNT_DATA_DIR || ".bounty/web");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyFile = join(directory, "access-key");
  let apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey) {
    try {
      apiKey = (await readFile(keyFile, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      apiKey = `ghnt_${randomBytes(24).toString("hex")}`;
      await writeFile(keyFile, apiKey + "\n", { mode: 0o600, flag: "wx" });
    }
    await chmod(keyFile, 0o600);
  }
  if (apiKey.length < 20)
    throw new Error("Use uma chave de acesso com pelo menos 20 caracteres.");
  const store = new BountyStore(directory);
  await store.init();
  const base = dirname(fileURLToPath(import.meta.url));
  const dashboard = resolve(base, "../../dashboard/dist");
  const app = await buildBountyApp({ store, apiKey, dashboard });
  app.addHook("onClose", async () => store.close());
  const close = () => {
    void app.close().catch((error) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  try {
    await app.listen({
      host: process.env.GHOSTHUNT_HOST || "127.0.0.1",
      port: Number(process.env.GHOSTHUNT_PORT || 3012),
    });
    console.log(
      `Ghosthunt Bug Bounty: http://localhost:${process.env.GHOSTHUNT_PORT || 3012}\nChave local: ${keyFile}\nDados: ${directory}`,
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
