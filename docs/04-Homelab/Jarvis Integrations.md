# Jarvis Integrations

## Connected Accounts
| Account | Purpose | Risk Level | Notes |
|---|---|---|---|
| info@signallogicsystems.com | Jarvis outbound/inbound email | Low | Dedicated account, nothing critical on it. Can be shut down independently. |

## Planned (Not Yet Connected)
| Account | Notes |
|---|---|
| Obsidian Vault (Google Drive) | Read-only service account via Drive API. Low risk. Do after Jarvis is stable. |
| Google Calendar | Higher stakes — wait until OpenClaw has proven stable operation |
| Gmail (personal) | Do not connect |

## Security Principles
- OpenClaw runs in an isolated VM — catastrophic failure is contained
- Never connect accounts where write access could cause irreversible damage
- Dedicated throwaway accounts for Jarvis where possible
- Vault read access = safe. Financial/communication write access = not yet.

## Status
- info@signallogicsystems.com: ✅ Connected
- Obsidian vault read access: 📋 Planned — see [[OpenClaw & Jarvis]]