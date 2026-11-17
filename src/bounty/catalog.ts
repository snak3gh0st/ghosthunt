import { z } from "zod";
import { validScopeRule } from "./scope.js";
import { BountyError } from "./model.js";

export const catalogSource =
  "https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json";
const assetSchema = z
  .object({
    asset_identifier: z.string(),
    asset_type: z.string().nullable().optional(),
    eligible_for_bounty: z.boolean().nullable().optional(),
    eligible_for_submission: z.boolean().nullable().optional(),
    instruction: z.string().nullable().optional(),
  })
  .passthrough();
const feedSchema = z
  .array(
    z
      .object({
        handle: z.string(),
        name: z.string(),
        url: z.string(),
        offers_bounties: z.boolean(),
        submission_state: z.string().optional(),
        targets: z.object({
          in_scope: z.array(assetSchema),
          out_of_scope: z.array(assetSchema),
        }),
      })
      .passthrough(),
  )
  .max(10000);
export interface CatalogProgram {
  handle: string;
  name: string;
  url: string;
  offersBounties: boolean;
  inScope: string[];
  outOfScope: string[];
  notes: string;
  omittedAssets: number;
  open: boolean;
  scopeReferences: {identifier:string;kind:"in"|"out";reason:string}[];
}

export function parseCatalog(input: unknown): CatalogProgram[] {
  return feedSchema
    .parse(input)
    .map((item) => {
      const allowed = item.targets.in_scope.filter(
        (a) =>
          a.eligible_for_submission !== false &&
          (!item.offers_bounties || a.eligible_for_bounty === true),
      );
      const inScope = allowed
        .filter((a) => (!a.asset_type || ["URL","WILDCARD","DOMAIN","IP_ADDRESS","SOURCE_CODE"].includes(a.asset_type.toUpperCase())) && validScopeRule(a.asset_identifier))
        .map((a) => a.asset_identifier);
      const outOfScope = item.targets.out_of_scope
        .filter((a) => (!a.asset_type || ["URL","WILDCARD","DOMAIN","IP_ADDRESS","SOURCE_CODE"].includes(a.asset_type.toUpperCase())) && validScopeRule(a.asset_identifier))
        .map((a) => a.asset_identifier);
      const omittedAssets =
        item.targets.in_scope.length +
        item.targets.out_of_scope.length -
        inScope.length -
        outOfScope.length;
      return {
        handle: item.handle,
        name: item.name,
        url: item.url,
        offersBounties: item.offers_bounties,
        inScope: [...new Set(inScope)],
        outOfScope: [...new Set(outOfScope)],
        omittedAssets,
        open: item.submission_state === "open",
        scopeReferences: (["in","out"] as const).flatMap(kind=>(kind === "in" ? item.targets.in_scope : item.targets.out_of_scope).filter(asset=>!(kind === "in" ? inScope : outOfScope).includes(asset.asset_identifier)).map(asset=>({identifier:asset.asset_identifier,kind,reason:`Referência do catálogo: ${asset.asset_type || "tipo não web ou sem elegibilidade de recompensa"}. Conferir na política oficial.`}))),
        notes: [
          `Fonte: ${catalogSource}`,
          `Programa: ${item.url}`,
          ...item.targets.in_scope.map(
            (a) =>
              `${a.asset_identifier}: ${a.instruction || "Consultar política oficial."}`,
          ),
          ...item.targets.out_of_scope.map(
            (a) => `Excluído: ${a.asset_identifier}. ${a.instruction || ""}`,
          ),
          ...(omittedAssets
            ? [
                `${omittedAssets} ativos omitidos (tipo não suportado ou sem elegibilidade de recompensa). Confira a política completa, inclusive exclusões e restrições.`,
              ]
            : []),
        ]
          .join("\n")
          .slice(0, 12000),
      };
    })
    .filter((item) => item.url.startsWith("https://hackerone.com/"));
}

export class Catalog {
  private cache: { fetchedAt: string; programs: CatalogProgram[] } | null =
    null;
  private pending: Promise<{
    fetchedAt: string;
    programs: CatalogProgram[];
  }> | null = null;
  async list(refresh = false) {
    if (
      !refresh &&
      this.cache &&
      Date.now() - Date.parse(this.cache.fetchedAt) < 30 * 60_000
    )
      return this.cache;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const response = await fetch(catalogSource, {
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Resposta vazia");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20_000_000) {
            await reader.cancel();
            throw new Error("Catálogo excedeu o limite.");
          }
          chunks.push(value);
        }
        this.cache = {
          fetchedAt: new Date().toISOString(),
          programs: parseCatalog(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          ),
        };
        return this.cache;
      } catch (error) {
        throw new BountyError(
          502,
          `Não foi possível atualizar o catálogo: ${(error as Error).message}`,
        );
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
}
