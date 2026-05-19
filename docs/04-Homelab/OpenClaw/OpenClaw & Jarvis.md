# OpenClaw & Jarvis

## OpenClaw VM
- **Host:** Proxmox server (home)
- **IP:** 192.168.4.62
- **OS:** Linux VM
- **Resources:** Most of Proxmox server resources allocated here

## Jarvis Discord Bot
- **Platform:** Discord
- **Purpose:** Personal assistant — calendar, to-do lists, home inventory, reminders
- **LLM backend:** Ollama (on OpenClaw)
- **API key:** Anthropic `sk-ant-` format configured
- **Status:** Running but has unresolved permissions/capabilities issues

## Known Issues
- Ollama/Jarvis memory and model loading issues — unresolved
- Discord bot permissions limiting some capabilities
- These are lower priority than SLS revenue work → do not let homelab troubleshooting displace SLS priorities

## Intended Use Cases (when working)
- Google Calendar read/write
- Home inventory tracking
- Chore/to-do lists
- SLS pipeline status
- Reminders and scheduling

## Access
- Local: `192.168.4.62`
- Remote: Tailscale (configured) or Chrome Remote Desktop to home PC → SSH



→ [[Jarvis Integrations]]