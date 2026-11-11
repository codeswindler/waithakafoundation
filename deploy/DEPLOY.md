# Deploying to a VPS (Ubuntu 24.04, PM2, Nginx, MySQL)

Target: **https://waithakafoundation.org**, code from **github.com/codeswindler/waithakafoundation**.
Commands are run on the VPS as a sudo user unless noted. Takes about 30 minutes.

## 1. Point the domain at the server

At your domain registrar, add DNS records:

| Type | Name | Value |
|---|---|---|
| A | `@` | your VPS IPv4 address |
| A | `www` | your VPS IPv4 address |

DNS can take a few minutes to a few hours. Check with `ping waithakafoundation.org`.

## 2. Install the software

Skip anything already on the server (Node 22+, Nginx, MySQL, PM2 and Certbot are often there already).

```bash
sudo apt update && sudo apt -y upgrade
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs nginx mysql-server certbot python3-certbot-nginx git
sudo npm install -g pm2
node -v   # must be 22.13 or newer
```

Firewall:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable
```

## 3. Create the database

```bash
APP_DB_PASS=$(openssl rand -hex 16); echo "Save this: $APP_DB_PASS"
sudo mysql <<SQL
CREATE DATABASE waithaka CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'waithaka'@'localhost' IDENTIFIED BY '$APP_DB_PASS';
GRANT ALL PRIVILEGES ON waithaka.* TO 'waithaka'@'localhost';
FLUSH PRIVILEGES;
SQL
```

The app creates its own tables on first start. Use a hex password like the one above. Special characters would need URL-encoding in `DATABASE_URL`.

## 4. Get the code

```bash
sudo mkdir -p /var/www/waithakafoundation && sudo chown $USER: /var/www/waithakafoundation
git clone https://github.com/codeswindler/waithakafoundation.git /var/www/waithakafoundation
cd /var/www/waithakafoundation
npm ci --omit=dev
mkdir -p logs
```

## 5. Configure

```bash
cat > .env <<EOF
DATABASE_URL=mysql://waithaka:$APP_DB_PASS@127.0.0.1:3306/waithaka
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@waithakafoundation.org
# Optional: email alerts for new enquiries (e.g. Zoho, Google Workspace, Brevo SMTP)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=website@waithakafoundation.org
# SMTP_PASS=...
# SMTP_FROM="Waithaka Foundation <website@waithakafoundation.org>"
EOF
chmod 600 .env
```

`PORT` (3460), `BASE_URL`, `COOKIE_SECURE` and `NODE_ENV` are already set by `ecosystem.config.js` (production). Port 3460 avoids the common 3000; check it is free first with `sudo ss -ltnp | grep ':3460 '` (no output means free). If it is taken, change it in both `ecosystem.config.js` and `deploy/nginx-waithakafoundation.conf`.

## 6. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup            # run the command it prints, so the site starts on boot
pm2 install pm2-logrotate
cat data/ADMIN_CREDENTIALS.txt   # first admin login; delete the file after signing in
curl -s http://127.0.0.1:3460/healthz   # {"ok":true}
```

## 7. Nginx + HTTPS

```bash
sudo cp deploy/nginx-waithakafoundation.conf /etc/nginx/sites-available/waithakafoundation
sudo ln -s /etc/nginx/sites-available/waithakafoundation /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d waithakafoundation.org -d www.waithakafoundation.org --redirect
```

Nginx needs to read uploaded files: `sudo chmod o+x /var/www /var/www/waithakafoundation` (and `uploads/` stays world-readable, which is the default).

Open https://waithakafoundation.org and https://waithakafoundation.org/admin.

## 8. Nightly backups

```bash
chmod +x deploy/backup.sh
sudo mkdir -p /var/backups/waithaka && sudo chown $USER: /var/backups/waithaka
(crontab -l 2>/dev/null; echo "30 2 * * * /var/www/waithakafoundation/deploy/backup.sh >> /var/www/waithakafoundation/logs/backup.log 2>&1") | crontab -
./deploy/backup.sh   # test once
```

Copy the backups off the server now and then (or set up `rclone` to Google Drive).

## Updating the site later

```bash
cd /var/www/waithakafoundation
git pull
npm ci --omit=dev
pm2 reload waithaka
```

Content (events, photos, settings) lives in MySQL and `uploads/`, so updates never touch it.

## Useful commands

| | |
|---|---|
| `pm2 status` | is it running |
| `pm2 logs waithaka` | live logs |
| `pm2 reload waithaka` | restart without downtime |
| `curl -s 127.0.0.1:3460/healthz` | app + database check |
