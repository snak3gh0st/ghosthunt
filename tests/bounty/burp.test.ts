import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  burpURL,
  parseBurpItems,
  readBurp,
  inspectBurp,
} from "../../src/bounty/burp.js";
import { programInput, type Program } from "../../src/bounty/model.js";
const target = "https://app.example.test/path";
const program: Program = {
  ...programInput.parse({
    name: "Burp lab",
    url: "https://hackerone.com/example",
    inScope: ["app.example.test"],
    outOfScope: ["https://app.example.test/private"],
    scopeConfirmed: true,
  }),
  id: "lab",
  scopeVersion: 1,
  createdAt: "",
  updatedAt: "",
};
let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
const block = (value: unknown) => ({
  type: "text",
  text: JSON.stringify(value),
});

it("only accepts loopback endpoints and never credentials or alternate paths", () => {
  for (const url of [
    "https://remote.test/mcp",
    "http://127.0.0.1:9876/other",
    "http://user:pass@127.0.0.1:9876/mcp",
    "http://127.0.0.1:9876/mcp?x=1",
  ]) {
    vi.stubEnv("GHOSTHUNT_BURP_MCP_URL", url);
    expect(() => burpURL()).toThrow();
  }
  vi.stubEnv("GHOSTHUNT_BURP_MCP_URL", "http://localhost:9876/mcp");
  expect(burpURL().hostname).toBe("127.0.0.1");
});
it("filters scope before storing records and redacts HTTP headers and JSON credentials", () => {
  const request =
    "GET /path HTTP/1.1\r\nHost: app.example.test\r\nAuthorization: Bearer fake-token\r\nCookie: session=fake-session\r\n\r\n";
  const result = parseBurpItems(
    [
      block({
        request,
        response:
          'HTTP/1.1 200 OK\r\nSet-Cookie: fake\r\n\r\n{"token":"fake-private-body"}',
      }),
      block({ request: request.replace("/path", "/private") }),
      block({ request: request.replace("app.example.test", "outside.test") }),
    ],
    target,
    program,
  );
  expect(result.items).toHaveLength(1);
  expect(result.skipped).toBe(2);
  expect(JSON.stringify(result.items)).not.toMatch(
    /fake-token|fake-session|fake-private-body/,
  );
  expect(
    parseBurpItems([block({ request })], target, {
      ...program,
      inScope: ["https://app.example.test"],
    }).items,
  ).toHaveLength(0);
  expect(() =>
    parseBurpItems(
      [{ type: "text", text: "HTTP history access denied by Burp Suite" }],
      target,
      program,
    ),
  ).toThrow("negada");
});
it("connects through the real MCP HTTP transport and calls only allowlisted read tools", async () => {
  const calls: string[] = [];
  server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let text = "";
    for await (const part of req) text += part;
    const message = JSON.parse(text);
    calls.push(
      message.method === "tools/call" ? message.params.name : message.method,
    );
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "burp-contract-fixture", version: "1" },
          }
        : message.method === "tools/list"
          ? {
              tools: [
                {
                  name: "get_proxy_http_history_regex",
                  description: "Read history",
                  inputSchema: {
                    type: "object",
                    properties: {
                      regex: { type: "string" },
                      count: { type: "number" },
                      offset: { type: "number" },
                    },
                  },
                },
                { name: "send_http1_request", inputSchema: { type: "object" } },
              ],
            }
          : {
              content: [
                block({
                  request:
                    "GET https://app.example.test/path HTTP/1.1\r\nHost: app.example.test\r\n\r\n",
                  response: "HTTP/1.1 200 OK",
                }),
              ],
              isError: false,
            };
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No address");
  vi.stubEnv("GHOSTHUNT_BURP_MCP_URL", `http://127.0.0.1:${address.port}/mcp`);
  const connection = await inspectBurp();
  expect(connection.tools.map((t) => t.name)).toEqual([
    "get_proxy_http_history_regex",
  ]);
  const result = await readBurp("burp-history", target, program);
  expect(result.code).toBe(0);
  expect(result.output).toContain("1 observações");
  expect(calls).toContain("get_proxy_http_history_regex");
  expect(calls).not.toContain("send_http1_request");
});
