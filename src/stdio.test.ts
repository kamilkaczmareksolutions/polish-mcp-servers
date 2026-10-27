import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const TOKEN_URL = "https://console.apify.com/settings/integrations";
const LAW_TOOL = "polish-law-mcp-server";
const root = fileURLToPath(new URL("..", import.meta.url));

type CatalogRow = {
  name: string;
  isPublic: boolean;
  inputSchema: { properties?: Record<string, { default?: unknown; maximum?: unknown }> };
};

const descriptions = JSON.parse(
  readFileSync(new URL("../catalog/tool-descriptions.json", import.meta.url), "utf8"),
) as Record<string, { description: string; parameters?: Record<string, string> }>;
const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
}).version;

const catalog = (JSON.parse(readFileSync(new URL("../catalog/actors.json", import.meta.url), "utf8")) as CatalogRow[])
  .filter((row) => row.isPublic);

function childEnv(token?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && key !== "APIFY_TOKEN") {
      env[key] = value;
    }
  }
  if (token !== undefined) {
    env.APIFY_TOKEN = token;
  }
  return env;
}

async function withClient(
  script: string,
  env: Record<string, string>,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [`${root}${script}`],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "polish-mcp-test", version: "0.0.0" });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
  }
}

function textOf(result: unknown): string {
  assert.ok(result !== null && typeof result === "object" && "content" in result);
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0] as { type?: string; text?: string };
  assert.equal(first.type, "text");
  if (typeof first.text !== "string") {
    assert.fail("tool result text missing");
  }
  return first.text;
}

function schemaOf(tool: { inputSchema: unknown }): {
  properties?: Record<string, { default?: unknown; maximum?: unknown }>;
} {
  assert.equal(typeof tool.inputSchema, "object");
  assert.ok(tool.inputSchema !== null);
  return tool.inputSchema as { properties?: Record<string, { default?: unknown; maximum?: unknown }> };
}

test("tools/list works without a token", async () => {
  await withClient("dist/main.js", childEnv(), async (client) => {
    assert.equal(client.getServerVersion()?.name, "polish-mcp");
    assert.equal(client.getServerVersion()?.version, packageVersion);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      catalog.map((row) => row.name),
    );
    for (const tool of listed.tools) {
      const row = catalog.find((entry) => entry.name === tool.name);
      assert.ok(row);
      const text = descriptions[tool.name];
      assert.ok(text, `${tool.name} has a description entry`);
      assert.equal(tool.description, text.description);
      for (const phrase of ["Read-only", "APIFY_TOKEN", "paid run", "300 s"]) {
        assert.equal(tool.description?.includes(phrase), true, `${tool.name} description mentions ${phrase}`);
      }
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
      assert.equal(tool.annotations?.openWorldHint, true);
      const listedProperties = schemaOf(tool).properties ?? {};
      const catalogProperties = row.inputSchema.properties ?? {};
      assert.equal(listedProperties.maxItems !== undefined, true);
      assert.ok(Number(listedProperties.maxItems?.maximum) <= 100);
      if (catalogProperties.maxItems === undefined) {
        assert.equal(listedProperties.maxItems?.default, 20);
        assert.equal(listedProperties.maxItems?.maximum, 100);
      } else {
        assert.deepEqual(
          Object.keys(listedProperties).sort(),
          Object.keys(catalogProperties).sort(),
        );
      }
    }
  });
});

test("law and registers profiles are partitions of the catalog", async () => {
  await withClient("dist/law.js", childEnv(), async (client) => {
    assert.equal(client.getServerVersion()?.name, "polish-law-mcp");
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      [LAW_TOOL],
    );
  });
  await withClient("dist/registers.js", childEnv(), async (client) => {
    assert.equal(client.getServerVersion()?.name, "polish-registers-mcp");
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes(LAW_TOOL), false);
    assert.equal(names.includes("cee-public-tenders"), true);
    assert.deepEqual(
      names,
      catalog.map((row) => row.name).filter((name) => name !== LAW_TOOL),
    );
  });
});

test("tools/call without a token returns an MCP error", async () => {
  for (const token of [undefined, ""]) {
    await withClient("dist/main.js", childEnv(token), async (client) => {
      const result = await client.callTool({ name: LAW_TOOL, arguments: {} });
      assert.equal(result.isError, true);
      const text = textOf(result);
      assert.equal(text.includes(TOKEN_URL), true);
      assert.equal(text.includes("APIFY_TOKEN"), true);
    });
  }
});

test("an unknown tool does not echo the token", async () => {
  await withClient("dist/main.js", childEnv("dummy-token"), async (client) => {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, catalog.length);
    const result = await client.callTool({ name: "no-such-tool", arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(textOf(result).includes("dummy-token"), false);
  });
});
