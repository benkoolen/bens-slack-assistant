# Slack Pulse Check

A GitHub Action that scrapes your Slack channels every Sunday, analyses them with Claude, and sends you a structured HTML email report covering concerns, opportunities, and things to nip in the bud.

---

## What you get

Every Sunday at 08:00 (London time) you'll receive an email with:

- **Overall health** — green / amber / red rating with rationale
- **Channel snapshots** — tone and key theme per channel
- **Concerns** — flagged issues with severity ratings
- **Nip in the bud** — specific actions with urgency
- **Opportunities** — upsell, process, relationship, or strategy plays
- **Positive signals** — things going well

---

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch
2. Name it something like "Pulse Check Bot"
3. Under **OAuth & Permissions** → **Bot Token Scopes**, add:
   - `channels:history`
   - `channels:read`
   - `users:read`
4. Click **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-...`)
5. Invite the bot to each channel you want to monitor: `/invite @pulse-check-bot`

### 2. Get your API keys

- **Anthropic API key**: [console.anthropic.com](https://console.anthropic.com) → API Keys
- **SMTP credentials**: see options below

### 3. Set up your email provider

**Gmail** (easiest):
1. Enable 2FA on your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Create an app password for "Mail"
4. Use:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=the-16-char-app-password
   ```

**Outlook / Microsoft 365**:
```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=you@yourcompany.com
SMTP_PASS=your-password
```

**Other providers** (Mailgun, SendGrid, etc.) — use their SMTP relay credentials.

### 4. Create the GitHub repository

```bash
# Create a new repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/slack-pulse-check
cd slack-pulse-check

# Copy these files into it
# (or push this directory directly)
git add .
git commit -m "Initial setup"
git push
```

### 5. Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add each of these:

| Secret name | Value |
|---|---|
| `SLACK_TOKEN` | Your `xoxb-...` bot token |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | e.g. `587` |
| `SMTP_USER` | Your sending email address |
| `SMTP_PASS` | Your SMTP password or app password |
| `REPORT_TO` | Where to send the report (can be comma-separated) |
| `REPORT_FROM` | Sender address (can be same as SMTP_USER) |
| `SLACK_CHANNELS` | Space or comma-separated channel names, e.g. `general client-comms new-business` |
| `LOOKBACK_DAYS` | `7` (or adjust) |
| `MAX_MESSAGES` | `100` |
| `FOCUS_LENS` | `agency` (or `product`, `startup`, `sales`) |

### 6. Test it manually

Once secrets are set, go to **Actions** → **Slack Pulse Check** → **Run workflow** to fire it immediately without waiting for Sunday.

---

## Local testing

```bash
cp .env.example .env
# Fill in .env with your credentials

npm install
npm test
```

---

## Customising the schedule

The workflow runs every Sunday at 07:00 UTC. To change this, edit `.github/workflows/pulse-check.yml`:

```yaml
schedule:
  - cron: "0 7 * * 0"   # Sunday 07:00 UTC
  # - cron: "0 7 * * 1"  # Monday instead
  # - cron: "0 7 * * 1,4"  # Monday and Thursday
```

Cron reference: [crontab.guru](https://crontab.guru)

---

## Costs

- **GitHub Actions**: Free for public repos; 2,000 minutes/month free on private repos (this job takes ~30 seconds)
- **Anthropic API**: Claude Sonnet ~$0.01–0.05 per run depending on transcript size
- **SMTP**: Free with Gmail app passwords

Total: effectively free for weekly use.

---

## Troubleshooting

**"Channel not found"** — Make sure you've invited the bot to the channel with `/invite @your-bot-name`

**"missing_scope" from Slack** — Re-check the bot has `channels:history` and `channels:read` scopes, and has been reinstalled to the workspace after adding them

**Email not arriving** — Check spam. For Gmail, confirm you're using an App Password (not your account password) with 2FA enabled

**Action fails silently** — Check the Actions tab in GitHub for the full error log
