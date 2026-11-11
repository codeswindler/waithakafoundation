# Waithaka Foundation for the Elderly: website & admin panel

A public website for sponsors, funders and the community, with a private admin panel where the foundation's team updates events, photos, videos and page content themselves. No developer is needed for day-to-day updates.

## What's in it

**Public website**

| Page | Purpose |
|---|---|
| Home | Banner photo, headline numbers, mission, the three programmes, upcoming events with a live countdown, the land campaign with a progress bar, past-event highlights, gallery, milestones, partners |
| About | Story, mission, core values, six objectives, governance structure (Board, Executive Officer, Audit / HR / Governance committees), board and team profiles |
| Programmes | Companionship, food & supplies, health & wellness, and what a monthly gathering costs (venue, food, facilitators, medical supplies, transport) |
| Events | Upcoming and past events; each event has its own page with report, achievements, attendance, photos, videos, add-to-calendar (Google, phone, Outlook) and share |
| Gallery | All photos and videos (uploaded videos and YouTube links) with a full-screen viewer |
| Impact | Numbers, milestone timeline, recent event reports, accountability |
| Support us | Ways to give, the land campaign, M-Pesa/bank details with copy buttons, partner and volunteer sign-up form |
| Contact | Contact details, map, message form |

**Admin panel** (`/admin`)

- **Dashboard** with a launch checklist showing what's still missing before sharing with sponsors
- **Events**: create, edit, hide, feature on the homepage, delete, "copy for next month"; upload photos/videos straight into an event
- **Photos & videos**: drag-and-drop bulk upload with a progress bar, captions, link to events, choose homepage photos and the banner, YouTube links for long videos
- **Achievements**: the milestone timeline
- **Partners & sponsors**: names, logos, links
- **Board & team**: names, roles, photos, bios
- **Website content**: headline, numbers, story, mission, campaign target and amount raised, M-Pesa/bank details, contact details, social media links
- **Messages**: enquiries from the website (partners, volunteers, general), optionally emailed to the team as they arrive
- **Account & admins**: change password, add or remove other admins

Photos are automatically resized and compressed so the site stays fast on mobile data.

## Run it on a computer

Needs **Node.js 22.13+** and **MySQL 8** (or MariaDB 10.6+). Docker gives you MySQL in one command.

```bash
cp .env.example .env      # then fill in the "Local development" lines
npm install
npm run db:up             # MySQL 8.4 in Docker on port 3418
npm run dev               # http://localhost:3100  (admin: /admin)
```

The app creates its tables on first start and fills the site with starting content from the foundation's brief. An admin account is created at the same time, and its login is written to `data/ADMIN_CREDENTIALS.txt`. You will be asked to set a new password on first sign-in; delete that file afterwards. To choose the first login yourself, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first start.

## Put it online

Step-by-step VPS guide (Ubuntu, PM2, Nginx, MySQL, HTTPS, nightly backups): **[deploy/DEPLOY.md](deploy/DEPLOY.md)**.

Settings (environment variables, in `.env` or the PM2 file):

| Variable | What it does |
|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/dbname` (or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) |
| `PORT` | Port to listen on (default 3000) |
| `BASE_URL` | Public address, `https://waithakafoundation.org` (social-media previews, sitemap, calendar files) |
| `COOKIE_SECURE=1` | Set once the site is on HTTPS |
| `NODE_ENV=production` | Longer browser caching |
| `SESSION_SECRET` | Signs admin login cookies (generated and stored automatically if not set) |
| `UPLOAD_DIR` | Where photos and videos are stored (default `./uploads`) |
| `MAX_VIDEO_MB` | Largest video upload allowed (default 300) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin login (only used when no admin exists yet) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional: email the team when someone writes in. Set the recipient in Admin → Website content → Contact |

`GET /healthz` returns `{"ok":true}` when the app and database are both up, for uptime monitors.

### Backups

Everything the team adds lives in **MySQL** and the **`uploads/`** folder. `deploy/backup.sh` dumps both nightly and keeps 14 days (see the deploy guide).

## Before sharing with sponsors

The dashboard checklist tracks these, but in short:

1. Phone number, email and WhatsApp (Website content → Contact)
2. M-Pesa Paybill / account and bank details (Website content → Giving)
3. Land campaign target and amount raised (Website content → Land campaign)
4. Replace or confirm the **four example events** created at setup. They are labelled "Example" in the admin; editing and saving one confirms it.
5. Upload real photos and videos from past gatherings
6. Add the Board of Directors and Executive Officer
7. Social media links

## Tests

```bash
npm test
```

Runs the whole site against a throwaway MySQL database (`TEST_DATABASE_URL`, name must contain "test"; its tables are wiped each run): every public page, forms and spam protection, admin login and forced password change, CSRF protection, creating events, uploading photos/videos/YouTube links, settings, partners, team, and XSS escaping.

## Technical notes

- Node.js + Express, EJS templates, MySQL/MariaDB via `mysql2`, `sharp` for image processing, PM2 in production. No build step.
- Tested on MySQL 8.4 and MariaDB 12.
- Security: bcrypt-hashed passwords, CSRF tokens on every admin form, login rate limiting, strict Content-Security-Policy, uploads limited to photo/video types, all content escaped on output, links restricted to http(s).
- The public site sets no cookies.
