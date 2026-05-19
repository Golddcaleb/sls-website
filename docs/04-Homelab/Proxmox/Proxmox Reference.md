# Proxmox Reference

## Server
- Home machine, limited specs
- Most resources allocated to OpenClaw VM

## VMs & Containers
| Name | Type | IP | Purpose | Status |
|---|---|---|---|---|
| OpenClaw | VM | 192.168.4.62 | Jarvis bot + Ollama | Running, some issues |

## Storage Pools
| Pool | Notes |
|---|---|
| local-lvm | Was nearly full — caused LXC container deployment failure |
| thin2 | 2TB pool — was failing to accept new containers (unresolved) |

## Notes
- LXC container storage selection failure was the last unresolved issue before pivoting away from local LLM work
- Not worth debugging further until there's a clear use case that justifies the time
