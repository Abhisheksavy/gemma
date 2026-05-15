# Gemma Inference Server — Deployment Guide

## API

| Method | Path | Auth required | Body | Response |
|--------|------|---------------|------|----------|
| POST | /api/chat | Yes (if API_KEY set) | `{ "message": "Hello" }` | `{ "reply": "..." }` |
| GET | /api/health | No | — | `{ "status": "ok", ... }` |
| GET | /api/metrics | Yes (if API_KEY set) | — | request stats + latency |

---

## Option A — Render (easiest, fully managed)

### How it works
A single Docker container (`Dockerfile.render`) runs both Ollama and the Node API.
A startup script (`start.sh`) boots Ollama, pulls the model if not cached, then starts Node.
A persistent disk at `/root/.ollama` caches the model between deploys so you don't re-download ~1.7 GB every time.

### Cost
| Plan | RAM | vCPU | Price | Notes |
|------|-----|------|-------|-------|
| Standard | 2 GB | 1 | $25/mo | Minimum — will work but inference is ~30–60s |
| Pro | 4 GB | 2 | $85/mo | Comfortable, ~15–30s response |
| Persistent disk 10 GB | — | — | $2.50/mo | Caches the model — highly recommended |

> Free and Starter plans (512 MB) are **not enough** for Gemma 2B.

### Step 1 — Push to GitHub

```bash
cd /path/to/gemma
git init            # already done if you cloned
git add -A
git commit -m "initial"
git remote add origin git@github.com:YOUR_USERNAME/gemma-api.git
git push -u origin main
```

### Step 2 — Create the Render service

**Option 2a — Blueprint (one click)**
1. Go to [render.com/deploy](https://render.com) → **New → Blueprint**
2. Connect your GitHub repo
3. Render will detect `render.yaml` and pre-fill everything
4. Click **Apply** — done

**Option 2b — Manual (dashboard)**
1. Go to render.com → **New → Web Service**
2. Connect your GitHub repo
3. Set these fields:

| Field | Value |
|-------|-------|
| Runtime | **Docker** |
| Dockerfile path | `./Dockerfile.render` |
| Instance type | **Standard** (2 GB) minimum |
| Health check path | `/api/health` |

4. Add a **Disk**:
   - Name: `ollama-models`
   - Mount path: `/root/.ollama`
   - Size: 10 GB

5. Add environment variables (copy from `.env.example`):

```
NODE_ENV=production
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma:2b
OLLAMA_TIMEOUT_MS=90000
OLLAMA_MAX_RETRIES=2
OLLAMA_RETRY_DELAY_MS=1000
CB_FAILURE_THRESHOLD=5
CB_COOLDOWN_MS=30000
QUEUE_CONCURRENCY=1
QUEUE_MAX_PENDING=10
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
MAX_MESSAGE_LENGTH=2000
CORS_ORIGIN=*
API_KEY=your-secret-key     ← set this in Render dashboard, not in git
```

6. Click **Create Web Service**

### Step 3 — First deploy (what to expect)

```
Build:   ~3–5 min   (Docker image + Ollama binary)
Start:   ~5–10 min  (first deploy: Ollama boots + pulls gemma:2b ~1.7 GB)
Start:   ~1–2 min   (subsequent deploys: model already on disk)
```

Watch logs in the Render dashboard — you'll see:
```
[start] Starting Ollama in background...
[start] Waiting for Ollama to accept connections...
[start] Ollama is up after 8s
[start] Pulling model 'gemma:2b' (this may take several minutes on first deploy)...
[start] Model pull complete
[start] Starting Node.js server...
INFO: Server started  port=3000
```

### Step 4 — Test your deployment

```bash
# Replace with your Render URL
BASE=https://gemma-api.onrender.com

# Health check
curl "$BASE/api/health"

# Chat
curl -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{"message":"What is machine learning? Answer in 2 sentences."}'
```

### Render gotchas & tips

**Free tier sleep** — Render free services sleep after 15min of inactivity. Standard+ plans stay awake.

**Slow first response** — Ollama loads the model into RAM on the first request (~10–30s). Subsequent requests are faster.

**Out of memory crash** — If you see OOM kills in logs, either:
- Upgrade to Pro (4 GB)
- Switch to smaller quantized model: change `OLLAMA_MODEL=gemma:2b-instruct-q4_0`

**Redeploy vs restart** — Use "Manual Deploy" in Render dashboard to redeploy. Model stays cached on the persistent disk.

---

## Option B — Local / Docker Compose (for testing)

```bash
cp .env.example .env
docker compose up -d

# First time only: pull model into Ollama container
docker exec -it gemma_ollama ollama pull gemma:2b

# Verify
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

---

## Option C — AWS EC2 (manual, max control)

### Recommended instance
- **t3.large** (2 vCPU, 8 GB RAM) — comfortable
- **t3.medium** (2 vCPU, 4 GB RAM) — minimum
- OS: Ubuntu 22.04 LTS

### 1. Connect
```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### 2. Install deps
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs && sudo npm i -g pm2
```

### 3. Install Ollama + pull model
```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable ollama && sudo systemctl start ollama

# Pull model
ollama pull gemma:2b
ollama list    # verify
```

### 4. Deploy the API
```bash
git clone <your-repo-url> /opt/gemma && cd /opt/gemma
npm install --omit=dev
cp .env.example .env && nano .env   # set NODE_ENV=production, CORS_ORIGIN, API_KEY

sudo mkdir -p /var/log/gemma && sudo chown ubuntu:ubuntu /var/log/gemma
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # follow printed command for auto-start on reboot
```

### 5. Nginx + SSL
```bash
sudo cp nginx.conf /etc/nginx/sites-available/gemma
sudo nano /etc/nginx/sites-available/gemma   # set your domain
sudo ln -s /etc/nginx/sites-available/gemma /etc/nginx/sites-enabled/gemma
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d your-domain.com      # free SSL via Let's Encrypt
```

### 6. Security Group (AWS Console)
Open: 22 (your IP only), 80, 443.
Block: 3000, 11434 — never expose these publicly.

---

## Memory optimization (CPU-only)

```bash
# Use 4-bit quantized model (~1.5 GB instead of 5 GB)
ollama pull gemma:2b-instruct-q4_0
# Then set: OLLAMA_MODEL=gemma:2b-instruct-q4_0

# Tune Ollama for low memory
# Add to /etc/systemd/system/ollama.service under [Service]:
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
sudo systemctl daemon-reload && sudo systemctl restart ollama

# Add swap if RAM < 4 GB
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Security checklist

- [ ] `API_KEY` set and not committed to git
- [ ] `CORS_ORIGIN` set to specific frontend URL (not `*`) in production
- [ ] Ports 3000 and 11434 not exposed publicly
- [ ] HTTPS only in production (Render handles this automatically)
- [ ] Rate limiting active (`RATE_LIMIT_MAX` tuned for your traffic)
- [ ] `.env` in `.gitignore`

---

## Useful commands

```bash
# Render — view live logs
# Go to dashboard → your service → Logs tab

# EC2 — PM2 logs
pm2 logs gemma-api
pm2 monit          # live dashboard

# Check Ollama
curl http://localhost:11434/api/tags | jq
ollama list
journalctl -u ollama -n 50    # EC2 only

# Test chat
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{"message":"Explain neural networks in 2 sentences"}'

# Metrics
curl http://localhost:3000/api/metrics \
  -H "Authorization: Bearer your-secret-key"
```
