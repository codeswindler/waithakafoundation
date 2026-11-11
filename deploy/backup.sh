#!/usr/bin/env bash
# Nightly backup: MySQL dump + uploaded photos/videos. Keeps the last 14 days.
# Schedule (as the app user):  crontab -e
#   30 2 * * * /var/www/waithakafoundation/deploy/backup.sh >> /var/www/waithakafoundation/logs/backup.log 2>&1
# Copy /var/backups/waithaka off the server regularly (e.g. rclone to Google Drive) for real safety.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-/var/backups/waithaka}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

# Read DATABASE_URL from .env: mysql://user:pass@host:port/dbname
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2-)"
proto_removed="${DATABASE_URL#mysql://}"
creds="${proto_removed%%@*}"; hostpart="${proto_removed#*@}"
DB_USER="${creds%%:*}"; DB_PASS="${creds#*:}"
DB_HOSTPORT="${hostpart%%/*}"; DB_NAME="${hostpart#*/}"
DB_HOST="${DB_HOSTPORT%%:*}"; DB_PORT="${DB_HOSTPORT#*:}"; [ "$DB_PORT" = "$DB_HOSTPORT" ] && DB_PORT=3306

MYSQL_PWD="$DB_PASS" mysqldump --single-transaction --no-tablespaces --routines \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" | gzip > "$DEST/db_$STAMP.sql.gz"
tar -czf "$DEST/uploads_$STAMP.tar.gz" -C "$APP_DIR" --exclude='uploads/tmp' uploads

find "$DEST" -name 'db_*.sql.gz' -mtime +14 -delete
find "$DEST" -name 'uploads_*.tar.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $DEST/db_$STAMP.sql.gz"

# Restore:
#   gunzip < db_YYYY-MM-DD_HHMM.sql.gz | mysql -u waithaka -p waithaka
#   tar -xzf uploads_YYYY-MM-DD_HHMM.tar.gz -C /var/www/waithakafoundation
