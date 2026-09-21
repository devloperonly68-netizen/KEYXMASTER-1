/*
 * KEYxMASTER — Railway entrypoint
 *
 * The files in commands/ were exported from a TeleBotHost/BJS runtime.
 * This adapter keeps those command files intact and supplies the runtime
 * objects they already use: Bot, User, Api, HTTP and Libs.ResourcesLib.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || "7088682169");
const ZAP_KEY = process.env.ZAP_KEY || "";
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE_PATH || path.join(__dirname, "data", "store.json");

if (!TOKEN) {
  console.error("BOT_TOKEN is missing. Add it in Railway → Variables.");
  process.exit(1);
}

function ensureDataFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ bot: {}, users: {}, resources: {} }, null, 2));
  }
}

ensureDataFile();

let store;
try {
  store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (error) {
  console.error("Could not read data file:", error.message);
  store = { bot: {}, users: {}, resources: {} };
}

store.bot = store.bot || {};
store.users = store.users || {};
store.resources = store.resources || {};

// Runtime configuration supplied by Railway Variables. Secrets are not hardcoded in source.\nif (ADMIN_ID) store.bot.owner_id = ADMIN_ID;\nif (ZAP_KEY) store.bot.zap_key = ZAP_KEY;\n
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tempFile = DATA_FILE + ".tmp";
    fs.writeFileSync(tempFile, JSON.stringify(store, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
  }, 20);
}

function asUserId(id) {
  return id === undefined || id === null ? "" : String(id);
}

function getUserStore(userId) {
  const id = asUserId(userId);
  store.users[id] = store.users[id] || {};
  return store.users[id];
}

function parseCommandHeader(source) {
  const header = source.match(/\/\*\*#command([\s\S]*?)#command\*\*\//);
  const block = header ? header[1] : "";
  const read = (key) => {
    const match = block.match(new RegExp("^\\s*" + key + "\\s*:\\s*(.*)$", "mi"));
    return match ? match[1].trim() : "";
  };
  return {
    name: read("name"),
    aliases: read("aliases").split(",").map((value) => value.trim()).filter(Boolean)
  };
}

const commands = new Map();
const commandDir = path.join(__dirname, "commands");

function registerCommandSource(file, source) {
  const metadata = parseCommandHeader(source);
  if (!metadata.name) return;

  const names = [metadata.name].concat(metadata.aliases);
  for (const name of names) {
    const key = String(name).trim().toLowerCase();
    if (key) commands.set(key, { file, source, name: metadata.name });
  }
}

// The compact Railway package stores all original command files in one JSON
// bundle so GitHub's browser upload limit is not a problem. The folder
// fallback keeps the package developer-friendly when commands/ is present.
const commandBundle = path.join(__dirname, "commands.bundle.json");
if (fs.existsSync(commandBundle)) {
  const bundledCommands = JSON.parse(fs.readFileSync(commandBundle, "utf8"));
  for (const item of bundledCommands) registerCommandSource(item.file, item.source);
} else if (fs.existsSync(commandDir)) {
  for (const file of fs.readdirSync(commandDir).filter((item) => item.endsWith(".js"))) {
    registerCommandSource(file, fs.readFileSync(path.join(commandDir, file), "utf8"));
  }
}

function normalizeCommand(value) {
  let command = String(value || "").trim().toLowerCase();
  if (command.includes("@")) command = command.split("@")[0];
  if (command && !command.startsWith("/") && command !== "*") command = "/" + command;
  return command;
}

function parseTextCommand(text) {
  const value = String(text || "").trim();
  if (!value.startsWith("/")) return { command: "*", params: "" };
  const parts = value.split(/\s+/);
  return {
    command: normalizeCommand(parts[0]),
    params: parts.slice(1).join(" ")
  };
}

function extractUser(update) {
  const source = update.message || update.callback_query?.from ||
    update.pre_checkout_query?.from || update.from || {};
  return {
    telegramid: source.id,
    id: source.id,
    first_name: source.first_name || "",
    last_name: source.last_name || "",
    username: source.username || ""
  };
}

function extractChat(update, user) {
  const chat = update.message?.chat ||
    update.callback_query?.message?.chat ||
    update.pre_checkout_query?.from || {};
  return { chatid: chat.id !== undefined ? chat.id : user.telegramid, id: chat.id };
}

function buildEvent(update, forcedParams) {
  const user = extractUser(update);
  const chat = extractChat(update, user);
  const messageObject = update.message || update.callback_query?.message || null;
  const text = update.message?.text || update.message?.caption || "";

  return {
    update,
    request: Object.assign({}, update, {
      update,
      message: messageObject,
      callback_query: update.callback_query,
      pre_checkout_query: update.pre_checkout_query,
      contact: update.message?.contact,
      photo: update.message?.photo,
      successful_payment: update.message?.successful_payment,
      id: update.callback_query?.id || update.pre_checkout_query?.id
    }),
    user,
    chat,
    message: text,
    params: forcedParams !== undefined ? forcedParams : parseTextCommand(text).params
  };
}

function telegramRequest(method, payload) {
  const url = "https://api.telegram.org/bot" + TOKEN + "/" + method;
  try {
    const response = require("child_process").execFileSync(
      "curl",
      ["-sS", "--max-time", "50", "-X", "POST", url,
        "-H", "Content-Type: application/json",
        "--data-binary", JSON.stringify(payload || {})],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    const parsed = JSON.parse(response);
    if (!parsed.ok) console.error("Telegram", method, parsed.description || parsed);
    return parsed;
  } catch (error) {
    console.error("Telegram request failed:", method, error.message);
    return { ok: false, description: error.message };
  }
}

function currentChatId(event) {
  return event.chat && event.chat.chatid !== undefined ? event.chat.chatid : event.user.telegramid;
}

function withCurrentChat(event, payload) {
  const data = Object.assign({}, payload || {});
  if (data.chat_id === undefined) data.chat_id = currentChatId(event);
  return data;
}

function userProperties(event) {
  return getUserStore(event.user.telegramid);
}

function makeResource(event, name, targetId) {
  const id = asUserId(targetId === undefined ? event.user.telegramid : targetId);
  const key = id + ":" + String(name);
  if (store.resources[key] === undefined) store.resources[key] = 0;
  return {
    value: () => Number(store.resources[key] || 0),
    add: (amount) => {
      store.resources[key] = Number(store.resources[key] || 0) + Number(amount || 0);
      saveStore();
      return store.resources[key];
    },
    remove: (amount) => {
      store.resources[key] = Number(store.resources[key] || 0) - Number(amount || 0);
      saveStore();
      return store.resources[key];
    }
  };
}

function parseReplyMarkup(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (error) { return value; }
}

function apiPayload(payload) {
  const result = Object.assign({}, payload || {});
  if (result.reply_markup !== undefined) result.reply_markup = parseReplyMarkup(result.reply_markup);
  return result;
}

function makeApi(event) {
  return {
    sendMessage: (payload) => telegramRequest("sendMessage", withCurrentChat(event, apiPayload(payload))),
    sendPhoto: (payload) => telegramRequest("sendPhoto", withCurrentChat(event, apiPayload(payload))),
    sendDocument: (payload) => telegramRequest("sendDocument", withCurrentChat(event, apiPayload(payload))),
    editMessageText: (payload) => telegramRequest("editMessageText", apiPayload(payload)),
    editMessageCaption: (payload) => telegramRequest("editMessageCaption", apiPayload(payload)),
    deleteMessage: (payload) => telegramRequest("deleteMessage", apiPayload(payload)),
    answerCallbackQuery: (payload) => telegramRequest("answerCallbackQuery", apiPayload(payload)),
    copyMessage: (payload) => telegramRequest("copyMessage", apiPayload(payload)),
    url: "https://api.telegram.org/bot" + TOKEN,
    token: TOKEN,
    admin_id: ADMIN_ID,
    zap_key: ZAP_KEY,
    id: process.env.BOT_ID || "",
    enabled: true,
    master_key: process.env.MASTER_KEY || "",
    api_key: process.env.PAYMENT_API_KEY || "",
    android_required: false
  };
}

function makeHttp(engine, event) {
  const requestHttp = (method, options) => {
    const config = options || {};
    const headers = Object.assign({}, config.headers || {});
    const fetchOptions = { method, headers };
    if (method !== "GET" && config.body !== undefined) {
      fetchOptions.body = typeof config.body === "string" ? config.body : JSON.stringify(config.body);
    }

    fetch(String(config.url), fetchOptions)
      .then(async (response) => {
        const raw = await response.text();
        let content = raw;
        try { content = JSON.parse(raw); } catch (error) {}
        const callback = response.ok ? config.success : config.error;
        if (callback) {
          const callbackOptions = {
            http_status: response.status,
            response: raw,
            url: config.url
          };
          engine.execute(callback, event, {
            content,
            options: callbackOptions,
            params: ""
          });
        }
      })
      .catch((error) => {
        if (config.error) {
          engine.execute(config.error, event, {
            content: String(error.message || error),
            options: { error: error.message || String(error) },
            params: ""
          });
        }
      });
  };

  return {
    get: (options) => requestHttp("GET", options),
    post: (options) => requestHttp("POST", options)
  };
}

function makeSandbox(engine, event, invocation) {
  const userId = asUserId(event.user.telegramid);
  const bot = {
    token: TOKEN,
    getProperty: (key) => store.bot[String(key)],
    setProperty: (key, value) => {
      if (value === undefined) delete store.bot[String(key)];
      else store.bot[String(key)] = value;
      saveStore();
    },
    sendMessage: (text, options) => telegramRequest("sendMessage", withCurrentChat(event, Object.assign({}, options || {}, {
      text: String(text === undefined || text === null ? "" : text)
    }))),
    sendMessageToChatWithId: (chatId, text, options) => telegramRequest("sendMessage", Object.assign({}, options || {}, {
      chat_id: chatId,
      text: String(text === undefined || text === null ? "" : text)
    })),
    run: (job) => {
      if (!job || !job.command) return;
      const jobOptions = job.options || {};
      let jobParams = jobOptions.params;
      if (jobParams === undefined && jobOptions.message !== undefined) {
        jobParams = parseTextCommand(jobOptions.message).params;
      }
      engine.execute(job.command, event, {
        params: jobParams === undefined ? "" : jobParams,
        options: jobOptions,
        content: undefined
      });
    },
    runCommand: (name) => engine.execute(normalizeCommand(name), event, { params: "", options: {} })
  };

  const user = {
    telegramid: event.user.telegramid,
    getProperty: (key) => userProperties(event)[String(key)],
    setProperty: (key, value) => {
      const properties = userProperties(event);
      if (value === undefined) delete properties[String(key)];
      else properties[String(key)] = value;
      saveStore();
    }
  };

  return {
    Bot: bot,
    User: user,
    Api: makeApi(event),
    HTTP: makeHttp(engine, event),
    Libs: {
      ResourcesLib: {
        userRes: (name) => makeResource(event, name),
        anotherUserRes: (name, targetId) => makeResource(event, name, targetId)
      }
    },
    bot,
    user: event.user,
    chat: event.chat,
    request: event.request,
    message: event.message,
    params: invocation.params === undefined ? event.params : invocation.params,
    options: invocation.options || {},
    content: invocation.content,
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    URL,
    URLSearchParams
  };
}

const engine = {
  execute(command, event, invocation) {
    const normalized = normalizeCommand(command);
    const entry = commands.get(normalized) || commands.get("*");
    if (!entry) {
      console.error("Command not found:", command);
      return;
    }

    const runtime = makeSandbox(this, event, invocation || {});
    const wrapped = "(function () {\n" + entry.source + "\n}).call(this);";
    try {
      vm.runInNewContext(wrapped, runtime, {
        filename: path.join(commandDir, entry.file),
        timeout: 120000
      });
    } catch (error) {
      console.error("Command error:", normalized, error.stack || error.message);
      try {
        telegramRequest("sendMessage", withCurrentChat(event, {
          text: "⚠️ System Error: " + error.message,
          parse_mode: "HTML"
        }));
      } catch (sendError) {}
    }
  }
};

function handleMessage(update, message) {
  const parsed = parseTextCommand(message.text || message.caption || "");
  const event = buildEvent(update, parsed.params);

  if (message.successful_payment) {
    engine.execute("/onSuccessfulPayment", event, { params: "", options: {} });
  } else if (parsed.command !== "*") {
    engine.execute(parsed.command, event, { params: parsed.params, options: {} });
  } else {
    engine.execute("*", event, { params: "", options: {} });
  }
}

function handleCallbackQuery(update, callbackQuery) {
  const data = callbackQuery.data || "";
  const parsed = parseTextCommand(data.startsWith("/") ? data : "/" + data);
  const event = buildEvent(update, parsed.params);
  event.request.message = callbackQuery.message;
  engine.execute(parsed.command === "*" ? "*" : parsed.command, event, {
    params: parsed.params,
    options: {}
  });
}

function handlePreCheckoutQuery(query) {
  const event = buildEvent({ pre_checkout_query: query }, "");
  engine.execute("/onPreCheckoutQuery", event, { params: "", options: {} });
}

let polling = true;
let updateOffset = Number(process.env.UPDATE_OFFSET || 0);

async function pollTelegram() {
  while (polling) {
    try {
      const url = "https://api.telegram.org/bot" + TOKEN +
        "/getUpdates?timeout=25&allowed_updates=" +
        encodeURIComponent(JSON.stringify(["message", "callback_query", "pre_checkout_query"]));
      const response = await fetch(url);
      const result = await response.json();
      if (!result.ok) {
        console.error("Telegram polling error:", result.description || result);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      for (const update of result.result || []) {
        updateOffset = Number(update.update_id) + 1;
        if (update.message) handleMessage(update, update.message);
        if (update.callback_query) handleCallbackQuery(update, update.callback_query);
        if (update.pre_checkout_query) handlePreCheckoutQuery(update.pre_checkout_query);
      }
    } catch (error) {
      console.error("Polling connection error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "x-panel-store" }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Health server listening on port", PORT);
  console.log("Loaded", commands.size, "command aliases.");
  pollTelegram();
});

process.on("SIGTERM", () => {
  polling = false;
  server.close(() => process.exit(0));
});