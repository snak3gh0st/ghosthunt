import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rm,
  copyFile,
  chmod,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const directory = resolve(process.env.GHOSTHUNT_DATA_DIR || ".bounty/web");
const lock = JSON.parse(
  await readFile(
    new URL("../bounty-integrations.json", import.meta.url),
    "utf8",
  ),
);
await mkdir(join(directory, "integrations"), { recursive: true, mode: 0o700 });
function command(binary, args) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!result.error && result.status === 0) return result.stdout.trim();
    const message = result.error?.message || result.stderr || "command failed";
    if (attempt === 2 || !/resolve host|timed out|connection reset|temporary failure|HTTP (?:429|50[0-9])/i.test(message)) throw new Error(`${binary}: ${message}`);
    console.log(`${binary}: falha temporária de rede; nova tentativa ${attempt + 2}/3`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}

for (const repo of lock.repositories) {
  const path = join(directory, "integrations", repo.id);
  try {
    await readFile(join(path, ".git", "HEAD"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    command("git", [
      "clone",
      "--filter=blob:none",
      `https://github.com/${repo.repository}.git`,
      path,
    ]);
  }
  const dirty = command("git", ["-C", path, "status", "--porcelain"]);
  const head = command("git", ["-C", path, "rev-parse", "HEAD"]);
  if (head !== repo.commit) {
    if (dirty)
      throw new Error(
        `Preserve as alterações locais em ${path} antes de atualizar.`,
      );
    command("git", [
      "-C",
      path,
      "fetch",
      "--depth",
      "1",
      "origin",
      repo.commit,
    ]);
    command("git", ["-C", path, "checkout", "--detach", repo.commit]);
  }
  console.log(`${repo.id}: ${repo.commit.slice(0, 12)}`);
}
if (process.argv.includes("--tools")) {
  const os = process.platform === "darwin" ? "macOS" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  await mkdir(join(directory, "bin"), { recursive: true, mode: 0o700 });
  for (const tool of lock.tools) {
    const platform = `${tool.id === "gau" && os === "macOS" ? "darwin" : os}_${arch}`;
    const expected = tool.sha256[platform];
    if (!expected) throw new Error(`Plataforma não suportada: ${platform}`);
    const format = tool.format || "zip";
    const name = `${tool.id}_${tool.version}_${platform}.${format}`;
    const response = await fetch(
      `https://github.com/${tool.repository || `projectdiscovery/${tool.id}`}/releases/download/v${tool.version}/${name}`,
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok)
      throw new Error(`Download ${name}: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(buffer).digest("hex") !== expected)
      throw new Error(`Checksum inválido para ${name}`);
    const temporary = await mkdtemp(join(tmpdir(), "ghosthunt-tool-"));
    try {
      const zip = join(temporary, name);
      await writeFile(zip, buffer);
      if (format === "zip")
        command("unzip", ["-q", zip, tool.id, "-d", temporary]);
      else command("tar", ["-xzf", zip, "-C", temporary, tool.id]);
      const destination = join(directory, "bin", tool.id);
      await copyFile(join(temporary, tool.id), destination);
      await chmod(destination, 0o700);
      await writeFile(destination + ".version", tool.version + "\n", {
        mode: 0o600,
      });
      console.log(`${tool.id}: ${tool.version} (SHA-256 verificado)`);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
for (const catalog of lock.catalogs || []) {
  const folder = join(directory, "catalogs");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const destination = join(folder, `${catalog.id}.json`);
  let existing;
  try {
    existing = await readFile(destination);
  } catch {}
  if (
    existing &&
    createHash("sha256").update(existing).digest("hex") === catalog.sha256
  ) {
    console.log(`${catalog.id}: catálogo conferido`);
    continue;
  }
  const response = await fetch(
    `https://raw.githubusercontent.com/${catalog.repository}/${catalog.commit}/${catalog.path}`,
    { signal: AbortSignal.timeout(120000), redirect: "error" },
  );
  if (!response.ok)
    throw Error(`Catálogo ${catalog.id}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 20_000_000 ||
    createHash("sha256").update(bytes).digest("hex") !== catalog.sha256
  )
    throw Error(`Catálogo ${catalog.id}: tamanho ou checksum inválido`);
  JSON.parse(bytes);
  await writeFile(destination, bytes, { mode: 0o600 });
  console.log(`${catalog.id}: metadados instalados, SHA-256 verificado`);
}
console.log(
  "Conhecimento instalado localmente. Use npm run web:build e npm run web:start.",
);
