# ScanIn Repository Naming Conventions

All ScanIn repositories follow a standardized naming pattern for clarity and organization.

---

## Naming Pattern

```
scanin-{category}-{name}
```

---

## Categories

| Prefix | Purpose | Example |
|----|----|----|
| `scanin-fw-*` | Firmware / embedded code | `scanin-fw-datalogger` |
| `scanin-web-*` | Web applications | `scanin-web-platform` |
| `scanin-svc-*` | Backend services (long-running) | `scanin-svc-mqtt-bridge` |
| `scanin-worker-*` | Batch processing / scheduled jobs | `scanin-worker-prism-daily` |
| `scanin-tool-*` | Utilities and tooling | `scanin-tool-esp-flasher` |
| `archive-*` | Legacy / archived repositories | `archive-HotBalloon` |

---

## Guidelines

- **Use lowercase** with hyphens as separators
- **Be descriptive** but concise
- **Category first** to enable easy filtering and grouping
- **Archived repos** are prefixed with `archive-` and remain private
