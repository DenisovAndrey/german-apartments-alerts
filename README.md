# German Apartments Alerts

Telegram bot that monitors German real estate platforms and sends instant notifications when new listings appear.

## Why?

Standard platform notifications are sent via email with 30+ minute delays. By then, landlords have already received hundreds of messages. This bot notifies you instantly, giving you a competitive advantage.

## Supported Platforms

- ImmobilienScout24
- Immowelt
- Immonet
- Kleinanzeigen

## Setup

### Prerequisites

- Node.js 22+
- PostgreSQL
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

### Installation

```bash
npm install
cp .env.example .env
# Edit .env with your settings
npm run build
npm start
```

### Docker

```bash
docker-compose up -d
```

## Usage

1. Start a chat with your bot on Telegram
2. Send `/start`
3. Click "Manage Notifications" to add your first search
4. Go to any supported platform, set your filters, copy the URL
5. Paste the URL in the bot

You'll receive instant notifications when new listings match your criteria.

## Bot Commands

- `/start` - Start the bot
- `/list` - Manage your searches
- `/help` - Show help
- `/clear` - Remove all searches

## Admin Bot (Optional)

A separate monitoring bot for administrators. Set these in `.env`:
- `ADMIN_TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `ADMIN_USER_ID` - Your Telegram user ID (only this user can access commands)

### Admin Commands

- `/users` - List all users with provider counts
- `/count` - Total user count
- `/count_queries` - Queries grouped by provider
- `/logs` - Show recent 20 log entries

Commands only work for the configured admin user ID.

### Admin Notifications

Automatically notifies you when:
- New user registers
- User adds/updates/removes a search
- Critical scraping errors occur (3+ consecutive failures)

### Logs

Important events are logged to `./data/app.log` in JSON format.

## License

MIT
