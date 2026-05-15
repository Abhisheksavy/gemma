# Gemma Inference Server — Deployment Guide

## Project structure

```
gemma/
├── src/
│   ├── config/index.js          # All env-driven config
│   ├── controllers/chatController.js
│   ├── routes/chat.js
│   ├── services/ollamaService.js  # Ollama API client
│   └── utils/logger.js
├── server.js                    # Entry point + graceful shutdown
├── src/app.js                   # Express app (middleware + routes)
├── Dockerfile
├── docker-compose.yml
├── ecosystem.config.cjs         # PM2 config
└── nginx.conf                   # Nginx reverse proxy
```

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | /api/chat | `{ "message": "Hello" }` | `{ "reply": "..." }` |
| GET | /api/health | — | `{ "status": "ok", "model": "loaded", ... }` |

---

## Option A — Local / Docker Compose (recommended for testing)

```bash
# 1. Install Docker + Docker Compose

# 2. Clone / place project
cd /path/to/gemma

# 3. Copy env
cp .env.example .env

# 4. Start Ollama + API together
docker compose up -d

# 5. Pull Gemma 2B into the running Ollama container (first time only ~1.7 GB)
docker exec -it gemma_ollama ollama pull gemma:2b

# 6. Verify
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, what is AI?"}'
```

---

## Option B — AWS EC2 (bare metal, CPU)

### Recommended instance
- **t3.medium** (2 vCPU, 4 GB RAM) — minimum for Gemma 2B
- **t3.large** (2 vCPU, 8 GB RAM) — comfortable
- OS: Ubuntu 22.04 LTS

### 1. Launch EC2 & connect

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### 2. Install system deps

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm i -g pm2

# FFmpeg (optional, not needed here but good to have)
# sudo apt install -y ffmpeg
```

### 3. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Enable as a system service
sudo systemctl enable ollama
sudo systemctl start ollama

# Verify
curl http://localhost:11434/api/tags
```

### 4. Pull Gemma 2B

```bash
ollama pull gemma:2b

# Verify model is available
ollama list
```

### 5. Deploy the API

```bash
# Clone or upload your project
git clone <your-repo-url> /opt/gemma
cd /opt/gemma

npm install --omit=dev

cp .env.example .env
nano .env          # set NODE_ENV=production, CORS_ORIGIN=https://your-domain.com

# Create log directory
sudo mkdir -p /var/log/gemma && sudo chown ubuntu:ubuntu /var/log/gemma

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # follow the printed command to enable on reboot
```

### 6. Nginx reverse proxy

```bash
sudo cp nginx.conf /etc/nginx/sites-available/gemma

# Edit domain name
sudo nano /etc/nginx/sites-available/gemma

sudo ln -s /etc/nginx/sites-available/gemma /etc/nginx/sites-enabled/gemma
sudo nginx -t && sudo systemctl reload nginx
```

### 7. SSL with Let's Encrypt

```bash
sudo certbot --nginx -d your-domain.com
# Certbot auto-updates nginx.conf for HTTPS
# Auto-renewal: sudo systemctl enable certbot.timer
```

### 8. EC2 Security Group

Open inbound ports:
- 22 (SSH) — your IP only
- 80 (HTTP) — 0.0.0.0/0
- 443 (HTTPS) — 0.0.0.0/0
- **Do NOT expose 3000 or 11434 publicly**

---

## Option C — Render (easiest, no server management)

> Render does not support Ollama natively (no persistent processes + no GPU on free tier).
> Best approach: deploy the Node API on Render and point it at an Ollama instance running elsewhere (EC2 / a dedicated VPS).

### Steps

1. Push project to GitHub (without `.env`)
2. Go to render.com → New → Web Service → connect repo
3. Build command: `npm install --omit=dev`
4. Start command: `node server.js`
5. Set environment variables in Render dashboard:

```
NODE_ENV=production
PORT=10000
OLLAMA_BASE_URL=http://<your-ec2-ip>:11434   # Ollama on EC2
OLLAMA_MODEL=gemma:2b
CORS_ORIGIN=https://your-frontend.com
```

6. On your EC2, open port 11434 **only for the Render outbound IP range** (or use a VPN/private network).

---

## Memory optimization for CPU-only deployment

```bash
# 1. Limit Ollama to 1 parallel request and 1 loaded model
# Add to /etc/systemd/system/ollama.service under [Service]:
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_FLASH_ATTENTION=1"     # reduces KV cache memory

sudo systemctl daemon-reload && sudo systemctl restart ollama

# 2. Use quantized model (4-bit, uses ~1.5 GB instead of ~5 GB)
ollama pull gemma:2b-instruct-q4_0        # set OLLAMA_MODEL=gemma:2b-instruct-q4_0

# 3. Enable Linux swap (if RAM < 4 GB)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. Node.js heap limit (already in ecosystem.config.cjs)
node --max-old-space-size=256 server.js
```

---

## Security checklist

- [ ] `CORS_ORIGIN` set to specific frontend origin (not `*`) in production
- [ ] Ports 3000 and 11434 blocked at firewall / security group
- [ ] Nginx handles TLS; Node runs on localhost only
- [ ] Rate limiting enabled (30 req/min default — tune `RATE_LIMIT_MAX`)
- [ ] Helmet sets secure HTTP headers
- [ ] Node process runs as non-root user (Dockerfile enforces this)
- [ ] `.env` excluded from git (`.gitignore`)
- [ ] PM2 `max_memory_restart` set to prevent runaway memory

---

## Useful commands

```bash
# Check API logs
pm2 logs gemma-api

# Restart API
pm2 restart gemma-api

# Check Ollama service
sudo systemctl status ollama
journalctl -u ollama -n 50

# List loaded models
curl http://localhost:11434/api/tags | jq

# Remove a model to free disk
ollama rm gemma:2b

# Test locally
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Explain machine learning in 2 sentences"}'
```
