import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { BountyError } from "./model.js";

type Module = {
  name: string;
  fullname: string;
  description: string;
  type: string;
  references: string[];
  platform: string;
  check: boolean;
  notes?: { SideEffects?: string[]; Stability?: string[] };
};
export class MetasploitCatalog {
  private cache: Module[] | null = null;
  constructor(private directory: string) {}
  async search(query: string, offset = 0) {
    const lock = JSON.parse(
      await readFile(
        new URL("../../bounty-integrations.json", import.meta.url),
        "utf8",
      ),
    ).catalogs?.find((c: { id: string }) => c.id === "metasploit");
    if (!lock)
      throw new BountyError(503, "Catálogo Metasploit não configurado.");
    if (!this.cache) {
      let bytes: Buffer;
      try {
        bytes = await readFile(
          join(this.directory, "catalogs", "metasploit.json"),
        );
      } catch {
        throw new BountyError(
          503,
          "Catálogo Metasploit não instalado. Execute a instalação local.",
        );
      }
      if (
        bytes.length > 20_000_000 ||
        createHash("sha256").update(bytes).digest("hex") !== lock.sha256
      )
        throw new BountyError(
          503,
          "O catálogo Metasploit precisa ser conferido pelo instalador.",
        );
      this.cache = (
        Object.values(JSON.parse(bytes.toString("utf8"))) as Module[]
      ).filter(
        (m) =>
          typeof m?.fullname === "string" &&
          typeof m.name === "string" &&
          typeof m.description === "string",
      );
    }
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const found = this.cache.filter((m) => {
      const text =
        `${m.fullname} ${m.name} ${m.description} ${m.platform} ${m.references?.join(" ")}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
    return {
      mode: "catalog-only",
      commit: lock.commit,
      total: found.length,
      offset,
      results: found
        .slice(offset, offset + 20)
        .map((m) => ({
          name: m.name,
          module: m.fullname,
          type: m.type,
          description: m.description.slice(0, 1800),
          references: m.references || [],
          platform: m.platform,
          hasCheck: m.check,
          sideEffects: m.notes?.SideEffects || [],
          url: `https://github.com/rapid7/metasploit-framework/blob/${lock.commit}/modules/${m.fullname}.rb`,
        })),
    };
  }
}
