# AHP NATS Transport

TypeScript NATS.io transport bindings for Agent Host Protocol (AHP).

Package target: `@wyrd-company/ahp-nats`.

This package contains the TypeScript implementation first, while keeping the
wire convention small enough to reimplement in other languages.

## Wire Convention

AHP JSON-RPC frames are UTF-8 JSON text payloads published over paired NATS
subjects:

```text
<namespace>.server.<serverId>.client.<clientId>.to-server
<namespace>.server.<serverId>.client.<clientId>.to-client
```

The default namespace is `ahp`. Subject tokens are sanitized to NATS-safe token
text.

## Development

```bash
npm install
npm run verify
```
