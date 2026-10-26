# AI Fusion Assistant — Advanced Starter

A full-stack starter app with:
- Account registration and login (bcrypt password hashing)
- SQLite database for users, chat messages, chat history, and sessions
- AI chat through the OpenAI Responses API
- Code assistant mode
- Web search mode using the Responses API `web_search` tool
- Image generation endpoint
- Browser speech-to-text voice input (Chrome/Edge support)
- Responsive dark UI

## Requirements

- Node.js 20 or newer
- An OpenAI API key with API billing and access to the models/tools you use
- Internet connection for package installation and AI features

## Setup on Windows

1. Install Node.js LTS from https://nodejs.org/ and restart your terminal.
2. Extract this ZIP to a folder, for example `C:\AI-Fusion`.
3. Open that folder in VS Code.
4. Open Terminal → New Terminal.
5. Install packages:

   ```bash
   npm install
   ```

6. Create your environment file by copying `.env.example` to `.env`.
   In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

7. Open `.env` and set:
   - `OPENAI_API_KEY` to your API key
   - `OPENAI_MODEL` to a text model available in your API project (default: `gpt-5.5`)
   - `SESSION_SECRET` to a long random secret

   Do not put the API key in `public/` files, commit it to Git, or share it.

8. Start the app:

   ```bash
   npm start
   ```

9. Open http://localhost:3000 in Chrome or Edge. Create an account, then start chatting.

## Features and use

- General AI: choose **General AI** and send a message.
- Code: choose **Code assistant** or click the Code quick action.
- Search: choose **Web search**. The model can use hosted web search and include source URLs in its answer.
- Image: click **Image studio** or **Generate image** and enter a prompt.
- Voice: click the microphone and allow microphone access. Speech recognition support depends on browser and device.
- History: chats are saved in `data/fusion.sqlite`; click a chat title to reopen it. Right-click a chat title to delete it.
- Sessions: session records are saved in `data/sessions.sqlite`.

## Troubleshooting

- **AI not configured:** check `.env` exists beside `server.js`, the API key is correct, then stop and restart `npm start`.
- **401 / model access:** confirm your API project has access to the configured model.
- **Billing or quota error:** check API billing and usage limits in your provider account.
- **Image generation error:** check that image generation is available for your account and that the API key has the necessary access.
- **Native module install issue:** `better-sqlite3` may need a supported Node LTS version. Install current Node.js LTS and retry `npm install`.
- **Microphone unavailable:** use localhost in Chrome/Edge, allow microphone access, and check system microphone settings.

## Important production checklist

This is a runnable local starter, not a hardened public deployment. Before exposing it to the internet:
- Use HTTPS and set `NODE_ENV=production`.
- Set a strong random `SESSION_SECRET`.
- Add CSRF protection and stricter security headers (for example Helmet).
- Add email verification, password reset, account deletion, abuse monitoring, and per-user quotas.
- Add file upload validation and malware scanning before implementing file uploads.
- Consider API cost limits, request timeouts, logging/monitoring, and backups.
- Review privacy, retention, and applicable legal requirements.
- Keep the database on persistent storage and restrict access to the data directory.

## API routes

- `POST /api/register` — create account
- `POST /api/login` — sign in
- `POST /api/logout` — sign out
- `GET /api/me` — current user
- `GET /api/chats` — list chats
- `POST /api/chats` — create chat
- `GET /api/chats/:id/messages` — load messages
- `DELETE /api/chats/:id` — delete a chat
- `POST /api/chat` — AI chat, code, or search (`mode: chat|code|search`)
- `POST /api/image` — image generation
- `GET /api/health` — server/API-key status

AI text responses use the OpenAI Responses API. Web search uses the built-in `web_search` tool. Image generation uses `gpt-image-1`.
