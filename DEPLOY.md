# Deploying report-forge (free hosting)

This app is a single always-on Node server that runs **headless Chrome** (for PDF export)
and stores submissions as files in `data/`. It must run as **one persistent instance** — not
serverless. Secrets are read from environment variables.

Required environment variables:

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | AI document extraction (required) |
| `ADMIN_PASSWORD` | Admin login |
| `PARTNER_PASSWORD` | Partner login |
| `GROQ_MODEL` | optional (defaults to `llama-3.3-70b-versatile`) |
| `PORT` | optional (host usually injects this) |

> Never commit `.env`. Set these in the host's dashboard / shell instead.

---

## Option A — Render.com (easiest free, but data is NOT durable)

Caveats: the free instance **sleeps after 15 min idle** (slow first request) and the disk is
**ephemeral** — `data/` submissions reset on every redeploy. Fine for a demo, not for durable storage.

1. Push this repo to GitHub (the `.gitignore` keeps `.env` and `data/` out).
2. On https://render.com → **New → Web Service** → connect the repo.
3. Environment: **Docker** (Render auto-detects the `Dockerfile`).
4. Add the environment variables from the table above.
5. Create the service. Render builds the image and gives you a `https://<name>.onrender.com` URL.

---

## Option B — Oracle Cloud "Always Free" VM (best free: persistent, 24/7)

A real free Ubuntu VM with a persistent disk. Card required only to verify signup (not charged
on Always Free). Pick an **Ampere (ARM)** shape for the most free RAM.

After creating the VM and SSHing in:

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Get the code
git clone <your-repo-url> report-forge && cd report-forge

# 3. Create .env with your secrets (NOT committed)
cat > .env <<'EOF'
GROQ_API_KEY=your_real_key
ADMIN_PASSWORD=a_strong_admin_password
PARTNER_PASSWORD=a_strong_partner_password
EOF

# 4. Build and run (data persists in a Docker volume, auto-restarts)
docker compose up -d --build
```

Open the VM's firewall for port 3000 (Oracle: add an ingress rule in the VCN security list,
and `sudo ufw allow 3000` if ufw is on). Visit `http://<vm-public-ip>:3000`.

For a domain + HTTPS, put Nginx (or Caddy) in front as a reverse proxy — ask and I'll provide it.

---

## Run locally with Docker (to test the image first)

```bash
docker compose up --build
# → http://localhost:3000
```
