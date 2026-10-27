import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CATALOG_URL = new URL("../catalog/actors.json", import.meta.url);
const DESCRIPTIONS_URL = new URL("../catalog/tool-descriptions.json", import.meta.url);
const PACKAGE_URL = new URL("../package.json", import.meta.url);
const TOKEN_URL = "https://console.apify.com/settings/integrations";
const MISSING_TOKEN = `Missing APIFY_TOKEN. Create a token at ${TOKEN_URL} and set APIFY_TOKEN.`;

const DEFAULT_MAX_ITEMS = 20;
const ITEM_CEILING = 100;
const RESPONSE_BYTE_CAP = 256 * 1024;
const SYNC_TIMEOUT_SECS = 300;
const FETCH_ABORT_MS = 320_000;

const LAW_INSTRUCTIONS =
  "One tool runs the law actor. Set tool to an enum value and pass arguments. maxItems caps returned dataset rows.";
const REGISTERS_INSTRUCTIONS =
  "Each tool runs one actor with that actor's input. maxItems caps dataset rows.";

export type Profile = "all" | "law" | "registers";

type JsonObject = Record<string, unknown>;

type ItemCap = {
  fallback: number;
  min: number;
  max: number;
  forward: boolean;
};

type ListedSchema = {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
};

// Every tool proxies a public read of an official register through an Apify Actor run.
const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

type ToolText = {
  description: string;
  parameters: Record<string, string>;
};

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: ListedSchema;
  actorId: string;
  buildNumber: string;
  router: boolean;
  cap: ItemCap;
};

type CallResult =
  | { kind: "error"; message: string }
  | { kind: "ok"; text: string };

type Prepared =
  | { kind: "error"; message: string }
  | { kind: "ok"; actorId: string; buildNumber: string; input: JsonObject; limit: number };

export async function serve(profile: Profile): Promise<void> {
  const tools = selectProfile(loadCatalog(CATALOG_URL, DESCRIPTIONS_URL), profile);
  const label = serverLabel(profile);
  const server = new Server(
    { name: label.name, version: readVersion(PACKAGE_URL) },
    { capabilities: { tools: {} }, instructions: label.instructions },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { title: tool.title, ...TOOL_ANNOTATIONS },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(
      tools,
      request.params.name,
      request.params.arguments,
      process.env,
    );
    return toMcp(result);
  });

  await server.connect(new StdioServerTransport());
}

function serverLabel(profile: Profile): { name: string; instructions: string } {
  switch (profile) {
    case "all":
      return { name: "polish-mcp", instructions: `${LAW_INSTRUCTIONS} ${REGISTERS_INSTRUCTIONS}` };
    case "law":
      return { name: "polish-law-mcp", instructions: LAW_INSTRUCTIONS };
    case "registers":
      return { name: "polish-registers-mcp", instructions: REGISTERS_INSTRUCTIONS };
    default: {
      const unreachable: never = profile;
      return unreachable;
    }
  }
}

function readVersion(url: URL): string {
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
  if (!isObject(parsed)) {
    throw new Error("package.json must be a JSON object.");
  }
  return requiredString(parsed.version, "version");
}

function loadToolTexts(url: URL): Map<string, ToolText> {
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
  if (!isObject(parsed)) {
    throw new Error("Tool descriptions must be a JSON object keyed by tool name.");
  }
  const texts = new Map<string, ToolText>();
  for (const [name, entry] of Object.entries(parsed)) {
    if (!isObject(entry)) {
      throw new Error(`Tool description for ${name} must be an object.`);
    }
    const parameters: Record<string, string> = {};
    if (entry.parameters !== undefined) {
      if (!isObject(entry.parameters)) {
        throw new Error(`Tool ${name} parameters must be an object.`);
      }
      for (const [key, text] of Object.entries(entry.parameters)) {
        parameters[key] = requiredString(text, `${name}.parameters.${key}`);
      }
    }
    texts.set(name, { description: requiredString(entry.description, `${name}.description`), parameters });
  }
  return texts;
}

function loadCatalog(url: URL, descriptionsUrl: URL): Tool[] {
  const texts = loadToolTexts(descriptionsUrl);
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("Actor catalog must be a JSON array.");
  }
  const tools: Tool[] = [];
  const names = new Set<string>();
  for (const row of parsed) {
    if (!isObject(row) || row.isPublic !== true) {
      continue;
    }
    const tool = bindTool(row, texts);
    if (names.has(tool.name)) {
      throw new Error(`Duplicate actor name ${tool.name}.`);
    }
    names.add(tool.name);
    tools.push(tool);
  }
  return tools;
}

function bindTool(row: JsonObject, texts: ReadonlyMap<string, ToolText>): Tool {
  const name = requiredString(row.name, "name");
  const actorId = requiredString(row.actorId, "actorId");
  const slash = actorId.indexOf("/");
  if (slash <= 0 || slash !== actorId.lastIndexOf("/") || slash === actorId.length - 1) {
    throw new Error(`Actor id ${actorId} must look like owner/name.`);
  }
  const title = requiredString(row.title, "title");
  const text = texts.get(name);
  if (text === undefined) {
    throw new Error(`Tool ${name} has no entry in catalog/tool-descriptions.json.`);
  }
  const description = text.description;
  const buildNumber = requiredString(row.buildNumber, "buildNumber");
  if (!isObject(row.inputSchema) || row.inputSchema.type !== "object") {
    throw new Error(`Actor ${name} inputSchema must be a JSON object schema.`);
  }
  const router = isLawRouter(row.inputSchema);
  const { inputSchema, cap } = listSchema(describeParameters(name, row.inputSchema, text.parameters));
  return { name, title, description, inputSchema, actorId, buildNumber, router, cap };
}

function describeParameters(name: string, schema: JsonObject, texts: Record<string, string>): JsonObject {
  const properties = schema.properties;
  if (!isObject(properties)) {
    throw new Error(`Actor ${name} inputSchema.properties must be an object.`);
  }
  const described: JsonObject = { ...properties };
  for (const [key, description] of Object.entries(texts)) {
    const property = properties[key];
    if (!isObject(property)) {
      throw new Error(`Tool ${name} describes unknown parameter ${key}.`);
    }
    described[key] = { ...property, description };
  }
  return { ...schema, properties: described };
}

function isLawRouter(schema: JsonObject): boolean {
  if (!isObject(schema.properties)) {
    return false;
  }
  const keys = Object.keys(schema.properties);
  if (keys.length !== 2 || !keys.includes("tool") || !keys.includes("arguments")) {
    return false;
  }
  const tool = schema.properties.tool;
  const args = schema.properties.arguments;
  if (!isObject(tool) || !isObject(args)) {
    return false;
  }
  return (
    tool.type === "string" &&
    Array.isArray(tool.enum) &&
    tool.enum.length > 0 &&
    tool.enum.every((entry) => typeof entry === "string") &&
    args.type === "object"
  );
}

function listSchema(schema: JsonObject): { inputSchema: ListedSchema; cap: ItemCap } {
  const properties = schema.properties;
  if (!isObject(properties)) {
    throw new Error("inputSchema.properties must be an object.");
  }
  const spec = properties.maxItems;
  if (spec === undefined) {
    const cap: ItemCap = { fallback: DEFAULT_MAX_ITEMS, min: 1, max: ITEM_CEILING, forward: false };
    const inputSchema: ListedSchema = {
      ...schema,
      type: "object",
      properties: {
        ...properties,
        maxItems: {
          type: "integer",
          title: "Maximum items",
          description:
            "Maximum dataset items returned to the client (1-100), applied by this server to the run's dataset.",
          default: cap.fallback,
          minimum: cap.min,
          maximum: cap.max,
        },
      },
    };
    return { inputSchema, cap };
  }
  if (!isObject(spec) || spec.type !== "integer") {
    throw new Error("maxItems must be an integer schema.");
  }
  const min = Math.max(1, integerField(spec.minimum, 1));
  const max = Math.max(min, Math.min(integerField(spec.maximum, ITEM_CEILING), ITEM_CEILING));
  let fallback = integerField(spec.default, Math.min(DEFAULT_MAX_ITEMS, max));
  if (fallback < min) {
    fallback = min;
  }
  if (fallback > max) {
    fallback = max;
  }
  const inputSchema: ListedSchema = {
    ...schema,
    type: "object",
    properties: {
      ...properties,
      maxItems: { ...spec, minimum: min, maximum: max, default: fallback },
    },
  };
  return { inputSchema, cap: { fallback, min, max, forward: true } };
}

function selectProfile(tools: readonly Tool[], profile: Profile): readonly Tool[] {
  const routers = tools.filter((tool) => tool.router);
  if (routers.length !== 1) {
    throw new Error(`Catalog must contain exactly one law router, found ${routers.length}.`);
  }
  switch (profile) {
    case "all":
      return tools;
    case "law":
      return tools.filter((tool) => tool.router);
    case "registers":
      return tools.filter((tool) => !tool.router);
    default: {
      const unreachable: never = profile;
      return unreachable;
    }
  }
}

async function callTool(
  tools: readonly Tool[],
  name: string,
  args: unknown,
  env: NodeJS.ProcessEnv,
): Promise<CallResult> {
  const token = readToken(env);
  if (token === undefined) {
    return { kind: "error", message: MISSING_TOKEN };
  }
  const prepared = prepareCall(tools, name, args);
  if (prepared.kind === "error") {
    return prepared;
  }
  const http = await postSync(prepared, token);
  if (http.kind === "error") {
    return http;
  }
  return { kind: "ok", text: fitItems(http.items, prepared.limit, http.total) };
}

function readToken(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.APIFY_TOKEN;
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  return raw.trim();
}

function prepareCall(tools: readonly Tool[], name: string, args: unknown): Prepared {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    return { kind: "error", message: `Unknown tool ${name}.` };
  }
  if (args === undefined || args === null) {
    args = {};
  }
  if (!isPlainObject(args)) {
    return { kind: "error", message: "Tool arguments must be an object." };
  }
  const limit = resolveLimit(args, tool.cap);
  if (typeof limit !== "number") {
    return { kind: "error", message: limit };
  }
  return {
    kind: "ok",
    actorId: tool.actorId,
    buildNumber: tool.buildNumber,
    input: actorInput(args, tool.cap, limit),
    limit,
  };
}

function resolveLimit(args: JsonObject, cap: ItemCap): number | string {
  if (!Object.prototype.hasOwnProperty.call(args, "maxItems")) {
    return cap.fallback;
  }
  const value = args.maxItems;
  if (typeof value !== "number" || !Number.isInteger(value) || value < cap.min || value > cap.max) {
    return `maxItems must be an integer from ${cap.min} to ${cap.max}.`;
  }
  return value;
}

function actorInput(args: JsonObject, cap: ItemCap, limit: number): JsonObject {
  if (!cap.forward) {
    const copy = { ...args };
    delete copy.maxItems;
    return copy;
  }
  return { ...args, maxItems: limit };
}

async function postSync(
  call: { actorId: string; buildNumber: string; input: JsonObject; limit: number },
  token: string,
): Promise<{ kind: "error"; message: string } | { kind: "ok"; items: unknown[]; total: number | null }> {
  const slash = call.actorId.indexOf("/");
  const actorPath = `${encodeURIComponent(call.actorId.slice(0, slash))}~${encodeURIComponent(call.actorId.slice(slash + 1))}`;
  const url = new URL(`https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", String(SYNC_TIMEOUT_SECS));
  url.searchParams.set("limit", String(call.limit));
  // Apify maxItems caps pay-per-result billing. It does not limit the array. limit does.
  url.searchParams.set("maxItems", String(call.limit));
  url.searchParams.set("build", call.buildNumber);
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(call.input),
      signal: AbortSignal.timeout(FETCH_ABORT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message: `Apify request failed: ${redact(message, token)}` };
  }

  const body = await response.text();
  if (response.status === 401 || response.status === 403) {
    return {
      kind: "error",
      message: `Apify rejected APIFY_TOKEN (HTTP ${response.status}). Check the token at ${TOKEN_URL}.`,
    };
  }
  if (!response.ok) {
    return {
      kind: "error",
      message: `Apify run failed (HTTP ${response.status}): ${redact(body, token).slice(0, 2000)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "error", message: "Apify returned a non-JSON dataset." };
  }
  if (!Array.isArray(parsed)) {
    return { kind: "error", message: "Apify returned a dataset that is not an array." };
  }
  const totalHeader = response.headers.get("x-apify-pagination-total");
  const total = totalHeader !== null && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null;
  return { kind: "ok", items: parsed, total };
}

function fitItems(items: readonly unknown[], itemLimit: number, total: number | null): string {
  let slice = items.slice(0, itemLimit);
  let truncated = items.length > slice.length || (total !== null && total > slice.length);
  while (slice.length > 1 && byteLength({ items: slice, truncated: true }) > RESPONSE_BYTE_CAP) {
    slice = slice.slice(0, -1);
    truncated = true;
  }
  let page = { items: slice, truncated };
  if (byteLength(page) <= RESPONSE_BYTE_CAP) {
    return JSON.stringify(page);
  }
  let preview = JSON.stringify(slice[0] ?? null);
  page = { items: [{ preview }], truncated: true };
  while (byteLength(page) > RESPONSE_BYTE_CAP && preview.length > 0) {
    preview = preview.slice(0, Math.floor(preview.length * 0.8));
    page = { items: [{ preview }], truncated: true };
  }
  return JSON.stringify(page);
}

function redact(text: string, token: string): string {
  return text.split(token).join("[redacted]").replace(/Bearer\s+\S+/g, "Bearer [redacted]");
}

function toMcp(result: CallResult): {
  content: [{ type: "text"; text: string }];
  isError?: true;
} {
  switch (result.kind) {
    case "ok":
      return { content: [{ type: "text", text: result.text }] };
    case "error":
      return { isError: true, content: [{ type: "text", text: result.message }] };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Catalog field ${field} must be a non-empty string.`);
  }
  return value;
}

function integerField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!isObject(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
