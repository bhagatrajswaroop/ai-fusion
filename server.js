import "dotenv/config";
import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 3000);
const SQLiteStore = SQLiteStoreFactory(session);
const db = new Database(path.join(dataDir, "fusion.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );
`);
db.pragma("foreign_keys = ON");

const openai = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_api_key_here"
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir, concurrentDB: true }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
app.use("/api/", apiLimiter);

const safeUser = (u) => ({ id: u.id, name: u.name, email: u.email });
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function ownChat(userId, chatId) {
  return db.prepare("SELECT * FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId);
}
function apiReady(res) {
  if (!openai) {
    res.status(503).json({ error: "AI is not configured yet. Add your OpenAI API key to .env and restart the server." });
    return false;
  }
  return true;
}
function makeTitle(text) {
  return text.trim().replace(/\s+/g, " ").slice(0, 52) || "New chat";
}

app.post("/api/register", authLimiter, async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 80);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2) return res.status(400).json({ error: "Name must contain at least 2 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10) return res.status(400).json({ error: "Use a password with at least 10 characters." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)").run(name, email, hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.json({ user: { id: Number(result.lastInsertRowid), name, email } });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "That email is already registered." });
    console.error(e); res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => {
  res.clearCookie("connect.sid"); res.json({ ok: true });
}));
app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare("SELECT id,name,email FROM users WHERE id = ?").get(req.session.userId);
  res.json({ user: user || null });
});

app.get("/api/chats", requireAuth, (req, res) => {
  const chats = db.prepare(`
    SELECT c.id,c.title,c.created_at,c.updated_at,
      (SELECT content FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_message
    FROM chats c WHERE c.user_id=? ORDER BY c.updated_at DESC
  `).all(req.session.userId);
  res.json({ chats });
});
app.post("/api/chats", requireAuth, (req, res) => {
  const title = makeTitle(String(req.body.title || "New chat"));
  const result = db.prepare("INSERT INTO chats (user_id,title) VALUES (?,?)").run(req.session.userId, title);
  res.json({ chat: db.prepare("SELECT * FROM chats WHERE id=?").get(result.lastInsertRowid) });
});
app.get("/api/chats/:id/messages", requireAuth, (req, res) => {
  const chatId = Number(req.params.id);
  if (!ownChat(req.session.userId, chatId)) return res.status(404).json({ error: "Chat not found." });
  res.json({ messages: db.prepare("SELECT id,role,content,created_at FROM messages WHERE chat_id=? ORDER BY id").all(chatId) });
});
app.delete("/api/chats/:id", requireAuth, (req, res) => {
  const chat = ownChat(req.session.userId, Number(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  db.prepare("DELETE FROM chats WHERE id=?").run(chat.id);
  res.json({ ok: true });
});

async function answerWithAI({ message, history = [], mode = "chat" }) {
  if (!openai) throw new Error("AI is not configured yet. Add your OpenAI API key to .env and restart the server.");
  const prompts = {
    chat: "You are AI Fusion, a helpful general assistant. Be accurate, clear, and adapt explanations to the user.",
    code: "You are AI Fusion Code Assistant. Write correct, runnable code. Explain key changes, identify bugs, and include tests or sample output when useful. Never claim code was executed unless it actually was.",
    search: "You are AI Fusion Research Assistant. Use web search for current or verifiable facts. Cite sources with clickable URLs in your answer. Clearly distinguish facts from uncertainty."
  };
  const input = [
    ...history.slice(-16).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    { role: "user", content: message }
  ];
  const params = { model: process.env.OPENAI_MODEL || "gpt-5.5", instructions: prompts[mode] || prompts.chat, input };
  if (mode === "search") params.tools = [{ type: "web_search" }];
  const response = await openai.responses.create(params);
  return response.output_text || "I couldn't produce a text answer for that request.";
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const message = String(req.body.message || "").trim();
  const mode = ["chat", "code", "search"].includes(req.body.mode) ? req.body.mode : "chat";
  let chatId = Number(req.body.chatId || 0);
  if (!message || message.length > 12000) return res.status(400).json({ error: "Message must contain 1–12,000 characters." });
  if (!chatId || !ownChat(req.session.userId, chatId)) {
    const result = db.prepare("INSERT INTO chats (user_id,title) VALUES (?,?)").run(req.session.userId, makeTitle(message));
    chatId = Number(result.lastInsertRowid);
  }
  const prior = db.prepare("SELECT role,content FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 16").all(chatId).reverse();
  db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chatId, "user", message);
  try {
    const reply = await answerWithAI({ message, history: prior, mode });
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chatId, "assistant", reply);
    db.prepare("UPDATE chats SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(chatId);
    res.json({ chatId, reply });
  } catch (e) {
    // Keep the user's message so the conversation is not lost; report the provider error safely.
    console.error("AI request failed:", e.message);
    res.status(502).json({ error: e.message.includes("not configured") ? e.message : "The AI request failed. Check your API key, model access, billing and server logs." , chatId });
  }
});

app.post("/api/image", requireAuth, async (req, res) => {
  if (!apiReady(res)) return;
  const prompt = String(req.body.prompt || "").trim();
  if (!prompt || prompt.length > 4000) return res.status(400).json({ error: "Image prompt must contain 1–4,000 characters." });
  try {
    const result = await openai.images.generate({ model: "gpt-image-1", prompt, size: "1024x1024" });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("The image provider returned no image data.");
    res.json({ image: `data:image/png;base64,${b64}` });
  } catch (e) {
    console.error("Image generation failed:", e.message);
    res.status(502).json({ error: "Image generation failed. Check API access, model availability, billing and server logs." });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true, aiConfigured: Boolean(openai) }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, () => {
  console.log(`AI Fusion Assistant running at http://localhost:${port}`);
  if (!openai) console.log("AI is not configured. Copy .env.example to .env and set OPENAI_API_KEY.");
});
