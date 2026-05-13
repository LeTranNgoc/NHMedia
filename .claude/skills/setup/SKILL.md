---
name: setup
description: "Install dev environment. Use when user says 'setup', 'init environment', or starts a new project."
argument-hint: "[--all|--node|--go|--python|--docker|--db|--init <template>]"
metadata:
  author: claudex-kit
  version: "1.1.0"
---

# Setup — Dev Environment Installer

Detect OS + install/verify dev tools + scaffold project templates.

## Arguments

| Flag | Action |
|------|--------|
| `--all` | Install all tools (includes --python) |
| `--node` | Node.js (nvm/fnm) + pnpm |
| `--go` | Go + Wails CLI |
| `--python` | Python 3.11+ + venv + skill dependencies |
| `--docker` | Docker Desktop/Engine + docker-compose (gated at Level 0 — see below) |
| `--db` | MongoDB + Redis. Native install at Level 0; docker at Level 1+ (see below) |
| `--init nestjs` | Scaffold NestJS project |
| `--init react` | Scaffold React + Vite project |
| `--init next` | Scaffold NextJS App Router project |
| `--init wails` | Scaffold Wails desktop app |
| `--init fullstack` | Scaffold NestJS + React + Docker monorepo |

## Level-Aware Install

Read `codingLevel` from `.claude/.claude-config.json` (default `0`). The level changes the install strategy for `--db` and `--docker`.

### Level 0 (Intern) — native install only

- **`--db`** → install MongoDB / PostgreSQL / Redis as native services. NO docker. NO docker-compose file generated. The DB runs as a system service on `localhost:<default-port>`. Reason: Docker on Level 0 is too much friction (daemon issues, image pulls, port mapping) when the user only needs a local DB.
  - Windows: `winget install MongoDB.Server` / `winget install PostgreSQL.PostgreSQL` / `winget install Redis.Redis`
  - macOS: `brew install mongodb-community` / `brew install postgresql@16` / `brew install redis` + `brew services start <name>`
  - Linux (Debian/Ubuntu): apt repos per official docs (mongodb-org, postgresql, redis-server) + `systemctl enable --now <name>`
- **`--docker`** → REJECTED unless the user passes `--force-docker` or the project genuinely requires Docker (e.g. a service with no native installer). Print: `"Level 0: skipping Docker install. Re-run with --force-docker if you really need it, or upgrade your codingLevel."` and stop.
- **`--init fullstack`** → swap the docker-compose template for a README that documents the native services started above.

### Level 1+ (Junior and up) — unrestricted

- `--db` → docker-compose.yml with mongo + redis (current behavior).
- `--docker` → installs Docker Desktop / Engine.
- No gating. Treat the user as capable of debugging container issues.

### Override

User can pass `--force-docker` at any level to bypass the Level 0 gate. State once: "forced via flag, level gate skipped" and proceed.

## Workflow

1. **Detect OS** → select package manager (winget/brew/apt)
2. **Check existing tools** → skip if already installed, report version
3. **Install missing** → run installer commands
4. **Verify** → version check for all tools
5. **If `--python`** → create venv + install skill dependencies
6. **If `--init`** → scaffold project structure

## Init Templates

### `--init nestjs`
```bash
pnpm dlx @nestjs/cli new <name> --package-manager pnpm
cd <name>
pnpm add prisma @prisma/client
npx prisma init --datasource-provider mongodb
# Create .env with DATABASE_URL
# Create docker-compose.yml (mongo + redis)
```

### `--init react`
```bash
pnpm create vite <name> --template react-ts
cd <name>
pnpm add -D tailwindcss @tailwindcss/vite
npx shadcn@latest init
```

### `--init next`
```bash
pnpm create next-app <name> --typescript --tailwind --eslint --app --src-dir
cd <name>
npx shadcn@latest init
```

### `--init wails`
```bash
wails init -n <name> -t react-ts
```

### `--init fullstack`
Monorepo with pnpm workspaces:
```
<name>/
├── pnpm-workspace.yaml
├── package.json
├── docker-compose.yml
├── apps/
│   ├── api/          # NestJS
│   └── web/          # React/Next
└── packages/
    └── shared/       # Shared types/utils
```

## Python Setup (`--python`)

Installs Python and creates a shared venv for skill scripts (docx, pdf, xlsx, skill-creator, etc.).

### Steps

1. **Check Python 3.11+** — if missing, install via package manager:
   ```bash
   # macOS
   brew install python@3.12

   # Ubuntu/Debian
   sudo apt-get install -y python3 python3-venv python3-pip

   # Windows (PowerShell)
   winget install Python.Python.3.12
   ```

2. **Create venv** at `.claude/skills/.venv`:
   ```bash
   python3 -m venv .claude/skills/.venv
   ```

3. **Install skill dependencies**:
   ```bash
   # Activate venv
   # Linux/macOS:
   source .claude/skills/.venv/bin/activate
   # Windows:
   .claude\skills\.venv\Scripts\activate

   # Install all skill packages
   pip install --prefer-binary \
     defusedxml \
     lxml \
     pypdf \
     pdf2image \
     Pillow \
     openpyxl \
     anthropic
   ```

4. **Verify installation**:
   ```bash
   python3 -c "import defusedxml, lxml, pypdf, pdf2image, PIL, openpyxl, anthropic; print('All packages OK')"
   ```

### Dependency Map

| Package | Used by | Purpose |
|---------|---------|---------|
| `defusedxml` | docx | Safe XML parsing for Word documents |
| `lxml` | docx | XML manipulation (OOXML) |
| `pypdf` | pdf | PDF read/write/merge/split |
| `pdf2image` | pdf | Convert PDF pages to images |
| `Pillow` | pdf | Image processing |
| `openpyxl` | xlsx | Excel file read/write |
| `anthropic` | skill-creator | Anthropic API SDK for evals |

### System Dependencies (optional)

Some packages need system libraries for full functionality:

| Package | System dep | Install |
|---------|-----------|---------|
| `pdf2image` | Poppler | `brew install poppler` / `apt install poppler-utils` |
| `lxml` | libxml2 | Usually bundled, but: `apt install libxml2-dev libxslt-dev` |

### Running Skill Scripts

After setup, all skill Python scripts should use the venv interpreter:

```bash
# Linux/macOS
.claude/skills/.venv/bin/python3 path/to/script.py

# Windows
.claude\skills\.venv\Scripts\python.exe path\to\script.py
```

## Output
Checklist table of installed tools + versions.
