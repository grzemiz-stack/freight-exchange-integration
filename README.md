# Freight Exchange Integration

Extract from a production freight forwarding management system — integration layer for publishing freight offers to [Trans.eu](https://www.trans.eu/) and [Timocom](https://www.timocom.com/) transport exchanges.

## What this does

Two NestJS modules that handle the full lifecycle of freight exchange integration:

### Trans.eu OAuth2 (`trans-eu-auth`)

Complete OAuth2 authorization code flow for the Trans.eu platform:

1. **Authorize** — generates the redirect URL with a base64url-encoded `state` parameter carrying the `companyId`
2. **Callback** — validates the `state`, exchanges the authorization code for an access/refresh token pair, and persists them
3. **Token storage** — tokens are stored per company in the `ExchangeConnection` table with expiration tracking
4. **Auto-refresh** — `getValidAccessToken()` transparently refreshes expired tokens (60-second buffer); if the refresh token itself has expired, the connection is marked `EXPIRED`
5. **Disconnect** — removes stored credentials

### Exchange Publisher (`exchange-publisher`)

Publishes freight offers to one or both exchanges in a single call:

- Builds platform-specific payloads (Trans.eu Freights API v2, Timocom REST API)
- Maps vehicle types, truck bodies, ADR/reefer requirements to each platform's format
- Records every successful publication in the `PublishedOffer` table
- Returns per-exchange success/error results — a failure on one exchange does not block the other

## Running the tests

```bash
npm install
npm test
```

Coverage report:

```bash
npm run test:cov
```

The test suite (36 tests) covers both services end-to-end with mocked `fetch` and `PrismaService` — no network calls, no database required.

## Project structure

```
src/
  trans-eu-auth/          OAuth2 flow: authorize, callback, token refresh, disconnect
  exchange-publisher/     Offer publishing to Trans.eu and Timocom
  prisma/                 PrismaService / PrismaModule
  auth/guards/            JwtAuthGuard
  common/                 CompanyGuard, CurrentUser decorator, JwtUser types
prisma/
  schema.prisma           ExchangeConnection + PublishedOffer models
test/
  trans-eu-auth.service.spec.ts
  exchange-publisher.service.spec.ts
```

## Note

This is a focused extract from a larger private system. The `Company` model is a minimal stub containing only the fields needed for the foreign-key relations (`id`, `name`). The full system includes fleet management, offer analysis, route planning, and more — it remains private.
