# Homelab Overview

## Hardware
- **Proxmox server** — home, not the best specs; most resources allocated to OpenClaw VM
- **OpenClaw VM** — IP: `192.168.4.62`

## Remote Access
- **Chrome Remote Desktop** — current method for accessing home PC from work
- **Tailscale** — set up, available for use
- Twingate: was considered, never moved forward — not in use

## Active Systems
→ [[OpenClaw & Jarvis]]

## Decision Log
- Spent several weeks trying to get a local LLM running on Proxmox to reduce API costs
- Hardware wasn't sufficient for reliable LLM inference
- **Decision (May 2026):** Stop pursuing local LLM. Upgrade Claude subscription instead.
  - Now running Claude, Claude Code, and Claude Cowork for primary AI work
  - OpenClaw still useful for Jarvis Discord bot and future automation — not for LLM inference

## Future Possibilities
- Self-hosted Cal.com (replace Calendly)
- Local task/calendar management via Jarvis once Discord bot permissions are resolved
- Home inventory tracking via Jarvis
