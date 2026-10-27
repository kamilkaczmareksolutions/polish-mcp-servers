# Polish MCP Servers

Two remote [Model Context Protocol](https://modelcontextprotocol.io) servers for Polish public data, hosted on [Apify](https://apify.com/enterprising_hamster). For those hosted servers, point your MCP client at a URL and authenticate with your Apify account.

- **Polish Law MCP**: Polish statutes from the Sejm ELI API (Dziennik Ustaw, Monitor Polski) and court judgments from SAOS.
- **Polish Public Registers**: 10 official Polish registers (EU-funded tenders, EV charging stations, vehicle registrations, building permits, land parcels and zoning, healthcare facilities, developer apartment prices, electricity market, legal acts, court judgments).

This repository contains a local stdio MCP server for the same public Actors, and the documentation for the hosted endpoints. The hosted servers still run as Apify Actors.

## Run locally

`tools/list` answers with no `APIFY_TOKEN` and no network. `tools/call` runs the Actor on your Apify account. Create a token at [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations) and set `APIFY_TOKEN`.

Each call returns at most 100 dataset items and at most 256 KiB of JSON. Pass `maxItems` to ask for fewer. When the actor schema already defaults `maxItems` to 100 or less, that default stands. The law tool defaults to 20, because that Actor's schema has no `maxItems`.

From this directory:

```bash
npm install
npm run build
node dist/main.js
```

`npx polish-mcp` runs the same process after `npm install`. Law only is `node dist/law.js` or `npx polish-law-mcp`. Registers only is `node dist/registers.js` or `npx polish-public-registers`. The registers process includes `cee-public-tenders`, which the hosted registers URL omits.

Docker image, no secrets required for `tools/list`:

```bash
docker build -t polish-mcp-servers .
docker run --rm -i polish-mcp-servers
```

Pass the token only when you want `tools/call` to run an Actor:

```bash
docker run --rm -i -e APIFY_TOKEN=<YOUR_APIFY_TOKEN> polish-mcp-servers
```

## Servers

| Server | MCP Registry name | MCP URL (Streamable HTTP) |
|---|---|---|
| Polish Law MCP | `io.github.kamilkaczmareksolutions/polish-law-mcp` | `https://mcp.apify.com/?tools=enterprising_hamster/polish-law-mcp-server` |
| Polish Law MCP (direct, Apify Standby) | same entry, second remote | `https://enterprising-hamster--polish-law-mcp-server.apify.actor/mcp` |
| Polish Public Registers | `io.github.kamilkaczmareksolutions/polish-public-registers` | see [full URL](#polish-public-registers-url) below |

### Polish Public Registers URL

```
https://mcp.apify.com/?tools=enterprising_hamster/polish-eu-funds-tenders-baza-konkurencyjnosci,enterprising_hamster/polish-ev-charging-stations-eipa,enterprising_hamster/polish-vehicle-registrations-cepik,enterprising_hamster/polish-building-permits-gunb,enterprising_hamster/polish-land-parcels-uldk-zoning,enterprising_hamster/polish-healthcare-facilities-rpwdl,enterprising_hamster/polish-developer-apartment-prices,enterprising_hamster/polish-electricity-market-pse,enterprising_hamster/polish-legal-acts-eli,enterprising_hamster/polish-court-judgments-saos
```

You can drop Actors from the `tools=` list to expose only the registers you need.

## Polish Law MCP: tools

Apify Actor: [enterprising_hamster/polish-law-mcp-server](https://apify.com/enterprising_hamster/polish-law-mcp-server)

| Tool | What it does |
|---|---|
| `search_legal_acts` | Search acts in Dziennik Ustaw and Monitor Polski (Sejm ELI). Returns act summaries with ELI ids. |
| `get_legal_act` | Metadata of one act: status, in-force flag, key dates, issuing body, implemented EU acts, newest consolidated text, references. |
| `get_legal_act_text` | Plain text of an act or a single article, current wording from the newest consolidated text, in bounded windows. |
| `list_changed_legal_acts` | Acts whose ELI record changed since a given time (new publications, amendments, status or reference updates). |
| `search_court_judgments` | Search judgments in SAOS (System Analizy Orzeczeń Sądowych). |
| `get_court_judgment` | Full judgment: metadata, legal bases, cited regulations (with ELI ids), cited cases, summary, text in bounded windows. |

Through `mcp.apify.com` the same six tools are exposed with an Apify prefix (`enterpri--polish-law-mcp-server--…`). The Standby URL exposes them under the names above.

Pricing (pay per event, FREE/BRONZE Apify plan tier):

| Event | Price |
|---|---|
| Tool call returning search results or metadata | $0.005 |
| Tool call returning the full text of a legal act or court judgment | $0.015 |

## Polish Public Registers: tools

Each Actor is exposed as one MCP tool that runs the Actor. The Apify MCP server also adds four helper tools: `get-actor-run`, `get-dataset-items`, `get-key-value-store-record`, `abort-actor-run` (14 tools in total).

Prices are per delivered result, FREE/BRONZE Apify plan tier. Higher plan tiers pay less; see each Actor page.

| Register (source) | Apify Actor | Price per result |
|---|---|---|
| EU-funds tenders (Baza Konkurencyjności) | [polish-eu-funds-tenders-baza-konkurencyjnosci](https://apify.com/enterprising_hamster/polish-eu-funds-tenders-baza-konkurencyjnosci) | $0.003 announcement; $0.008 announcement with details |
| EV charging stations (EIPA / UDT) | [polish-ev-charging-stations-eipa](https://apify.com/enterprising_hamster/polish-ev-charging-stations-eipa) | $0.003 station; $0.001 station with anonymised private operator |
| Vehicle registrations (CEPiK open data, aggregates only) | [polish-vehicle-registrations-cepik](https://apify.com/enterprising_hamster/polish-vehicle-registrations-cepik) | $0.003 statistics row |
| Building permits (GUNB RWDZ) | [polish-building-permits-gunb](https://apify.com/enterprising_hamster/polish-building-permits-gunb) | $0.002 project; $0.006 project with organisation investor |
| Land parcels and zoning (GUGiK ULDK, MPZP, POG) | [polish-land-parcels-uldk-zoning](https://apify.com/enterprising_hamster/polish-land-parcels-uldk-zoning) | $0.004 parcel; $0.02 parcel with zoning |
| Healthcare facilities (RPWDL) | [polish-healthcare-facilities-rpwdl](https://apify.com/enterprising_hamster/polish-healthcare-facilities-rpwdl) | $0.004 facility |
| Developer apartment prices (dane.gov.pl) | [polish-developer-apartment-prices](https://apify.com/enterprising_hamster/polish-developer-apartment-prices) | $0.002 offer; $0.004 price change |
| Electricity market (PSE API) | [polish-electricity-market-pse](https://apify.com/enterprising_hamster/polish-electricity-market-pse) | $0.0003 market data row |
| Legal acts (Sejm ELI) | [polish-legal-acts-eli](https://apify.com/enterprising_hamster/polish-legal-acts-eli) | $0.002 act metadata; $0.008 act with text |
| Court judgments (SAOS) | [polish-court-judgments-saos](https://apify.com/enterprising_hamster/polish-court-judgments-saos) | $0.003 judgment metadata; $0.01 judgment with full text |

Apify platform usage may be billed on top, depending on your Apify plan.

## Authentication and billing

Both servers run under your own Apify account, and you pay for the results you request.

- **OAuth** via `mcp.apify.com`: clients that support MCP OAuth sign you in to Apify. No token in the config.
- **Bearer token**: send `Authorization: Bearer <YOUR_APIFY_TOKEN>`. Get the token at [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations). Required for the Standby URL.

Requests without credentials get HTTP 401.

## Client configuration

Replace `<YOUR_APIFY_TOKEN>` with your token, or omit `headers` if your client supports OAuth.

### Claude.ai and Claude Desktop

Settings → Connectors → Add custom connector, then paste the MCP URL (e.g. `https://mcp.apify.com/?tools=enterprising_hamster/polish-law-mcp-server`). Sign in to Apify when prompted.

### Cursor

`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "polish-law": {
      "url": "https://mcp.apify.com/?tools=enterprising_hamster/polish-law-mcp-server",
      "headers": {
        "Authorization": "Bearer <YOUR_APIFY_TOKEN>"
      }
    },
    "polish-public-registers": {
      "url": "https://mcp.apify.com/?tools=enterprising_hamster/polish-eu-funds-tenders-baza-konkurencyjnosci,enterprising_hamster/polish-ev-charging-stations-eipa,enterprising_hamster/polish-vehicle-registrations-cepik,enterprising_hamster/polish-building-permits-gunb,enterprising_hamster/polish-land-parcels-uldk-zoning,enterprising_hamster/polish-healthcare-facilities-rpwdl,enterprising_hamster/polish-developer-apartment-prices,enterprising_hamster/polish-electricity-market-pse,enterprising_hamster/polish-legal-acts-eli,enterprising_hamster/polish-court-judgments-saos",
      "headers": {
        "Authorization": "Bearer <YOUR_APIFY_TOKEN>"
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "apify-token",
      "description": "Apify API token",
      "password": true
    }
  ],
  "servers": {
    "polish-law": {
      "type": "http",
      "url": "https://mcp.apify.com/?tools=enterprising_hamster/polish-law-mcp-server",
      "headers": {
        "Authorization": "Bearer ${input:apify-token}"
      }
    }
  }
}
```

Add `polish-public-registers` the same way with its URL.

### Local stdio

Use this when you run the server from this repository. Replace the path with your checkout. Hosted `url` entries above stay valid.

Claude Desktop uses `claude_desktop_config.json`. Cursor uses `~/.cursor/mcp.json` or `.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "polish-law": {
      "command": "node",
      "args": ["/absolute/path/to/polish-mcp-servers/dist/law.js"],
      "env": {
        "APIFY_TOKEN": "<YOUR_APIFY_TOKEN>"
      }
    },
    "polish-public-registers": {
      "command": "node",
      "args": ["/absolute/path/to/polish-mcp-servers/dist/registers.js"],
      "env": {
        "APIFY_TOKEN": "<YOUR_APIFY_TOKEN>"
      }
    }
  }
}
```

Omit `APIFY_TOKEN` if you only want `tools/list`. A call then returns an MCP tool error that points at the token page.

## Official MCP Registry

- `io.github.kamilkaczmareksolutions/polish-law-mcp`
- `io.github.kamilkaczmareksolutions/polish-public-registers`

Look them up at `https://registry.modelcontextprotocol.io/v0.1/servers?search=kamilkaczmareksolutions`.

## Data sources

All data comes from official Polish public registers and open-data APIs: Sejm ELI, SAOS, Baza Konkurencyjności, EIPA (UDT), CEPiK, GUNB, GUGiK ULDK, RPWDL, dane.gov.pl, PSE. Personal data is limited: building-permit investors who are private persons are anonymised, private EV station operators are anonymised, CEPiK data is aggregated (no VINs or owners), and ULDK parcels come without owners.

## License

This repository is released under the [MIT License](LICENSE).
