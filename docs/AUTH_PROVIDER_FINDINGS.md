# Auth Provider Findings

Date: 2026-05-01

## Current Loreum auth stack

Loreum currently uses NestJS plus Passport, not a batteries-included provider such as NextAuth/Auth.js.

Implemented today:

```text
+----------------+----------------------------+------------------+
| Auth mechanism | Package                    | Status in Loreum |
+----------------+----------------------------+------------------+
| Google OAuth   | passport-google-oauth20    | Implemented      |
| JWT sessions   | passport-jwt               | Implemented      |
+----------------+----------------------------+------------------+
```

Important distinction: JWT is not a sign-in option. It is the post-login session/token mechanism after a provider or local login authenticates the user.

## Passport strategy model

Passport supports authentication mechanisms through installed and registered strategy packages. Being supported by Passport does **not** mean a method is enabled in the app. The app still needs all of these layers:

```text
+---------------------+---------------------------------------------------------+
| Layer               | Requirement                                             |
+---------------------+---------------------------------------------------------+
| npm package         | Strategy package installed                              |
| Nest provider       | Strategy class registered conditionally                 |
| Config              | Provider-specific config loaded only when enabled       |
| Controller routes   | Login and callback routes wired                         |
| Data model/service  | Provider profile normalized into Loreum user/account    |
| Frontend            | Sign-in button or form rendered only when enabled        |
+---------------------+---------------------------------------------------------+
```

## Recommended homelab priority

```text
+------+----------------------+----------------------------------------------------------+
| Rank | Option               | Notes                                                    |
+------+----------------------+----------------------------------------------------------+
| 1    | Local email/password | No external IdP; needs secure password hashing/flows     |
| 2    | OIDC                 | Best if Authentik/Authelia/Keycloak is already present  |
| 3    | Discord OAuth        | Good fit for Discord-adjacent users                     |
| 4    | GitHub OAuth         | Good for developer-heavy audiences; email handling care |
| 5    | Magic link           | Nice UX; requires outbound email infrastructure         |
+------+----------------------+----------------------------------------------------------+
```

## Discord OAuth requirements

Typical package: `passport-discord`

Provider-side setup:

```text
Discord Developer Portal
  -> Applications
  -> New Application
  -> OAuth2
  -> Add redirect URI:
     https://<api-host>/v1/auth/discord/callback
  -> Copy Client ID
  -> Copy Client Secret
```

Runtime config:

```text
AUTH_DISCORD_ENABLED=true
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_CALLBACK_URL=https://<api-host>/v1/auth/discord/callback
```

Scopes for plain login:

```text
identify email
```

Notes:

```text
+--------------------+---------------------------------------------------------+
| Question           | Answer                                                  |
+--------------------+---------------------------------------------------------+
| Bot required?      | No, not for OAuth login.                                |
| Server membership? | Not unless access should be restricted to a guild.      |
| Guild restriction? | Possible with `guilds` scope plus allowed-guild checks. |
| Email footgun      | Request email but still handle missing email safely.    |
+--------------------+---------------------------------------------------------+
```

## GitHub OAuth requirements

Typical package: `passport-github2`

Provider-side setup:

```text
GitHub
  -> Settings
  -> Developer settings
  -> OAuth Apps
  -> New OAuth App
  -> Authorization callback URL:
     https://<api-host>/v1/auth/github/callback
  -> Copy Client ID
  -> Generate/copy Client Secret
```

Runtime config:

```text
AUTH_GITHUB_ENABLED=true
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://<api-host>/v1/auth/github/callback
```

Scopes:

```text
user:email
```

Notes:

```text
+--------------------+--------------------------------------------------------------+
| Concern            | Notes                                                        |
+--------------------+--------------------------------------------------------------+
| Email availability | GitHub users may hide email; do not assume profile email.    |
| Verified email     | Prefer verified primary email where available.               |
| Org restriction    | Possible, but requires extra API calls/scope/logic.          |
| Login UX           | Easier than Google for developer-heavy users.                |
+--------------------+--------------------------------------------------------------+
```

## Provider-gating recommendation

Before adding more OAuth providers, Google should be made optional. Otherwise an unused provider can still make secrets mandatory at API startup.

Suggested toggles:

```text
AUTH_LOCAL_ENABLED=true
AUTH_GOOGLE_ENABLED=false
AUTH_DISCORD_ENABLED=false
AUTH_GITHUB_ENABLED=false
```

Provider-specific secrets should be required only when that provider is enabled.

## Future implementation note

A clean multi-provider UI should expose enabled providers from the API, for example:

```text
GET /v1/auth/providers
```

This lets the frontend render only enabled auth choices without hardcoding Google or requiring a frontend rebuild for every provider toggle.
