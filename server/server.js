const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const cors = require("cors")
const multer = require("multer")
const sharp = require("sharp")
const path = require("path")
const fs = require("fs")

const Database = require("./database")
const WebSocketHandler = require("./websocket-handler")
const GameEngine = require("./game-engine")

class MafiaGameServer {
  constructor() {
    this.app = express()
    this.server = http.createServer(this.app)
    this.wss = new WebSocket.Server({ server: this.server })

    this.db = new Database()
    this.gameEngine = new GameEngine()
    this.wsHandler = new WebSocketHandler(this.wss, this.db, this.gameEngine)

    // Устанавливаем связи
    this.gameEngine.setRooms(this.wsHandler.rooms)
    this.gameEngine.setDatabase(this.db)

    this.setupMiddleware()
    this.setupRoutes()
    this.setupErrorHandling()

    this.port = process.env.PORT || 3000
  }

  setupMiddleware() {
    // CORS
    this.app.use(
      cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
      }),
    )

    // JSON парсер
    this.app.use(express.json({ limit: "10mb" }))
    this.app.use(express.urlencoded({ extended: true }))

    // Статические файлы
    this.app.use("/uploads", express.static(path.join(__dirname, "uploads")))
    this.app.use("/static", express.static(path.join(__dirname, "public")))

    // Создаём папку для загрузок если её нет
    const uploadsDir = path.join(__dirname, "uploads")
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }

    // Логирование
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
      next()
    })
  }

  setupRoutes() {
    // API маршруты
    this.app.use("/api", this.createApiRoutes())

    // Главная страница
    this.app.get("/", (req, res) => {
      res.json({
        name: "🎭 Mafia Game Server",
        version: "2.0.0",
        status: "running",
        uptime: Math.floor(process.uptime()),
        admin: "Anubis - Великий Бог",
        stats: {
          ...this.wsHandler.getStats(),
          ...this.gameEngine.getGameStats(),
        },
      })
    })

    // Админ панель
    this.app.get("/admin", (req, res) => {
      res.send(this.generateAdminPage())
    })

    // Здоровье сервера для Render
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    })
  }

  createApiRoutes() {
    const router = express.Router()

    // Настройка multer для загрузки аватарок
    const storage = multer.memoryStorage()
    const upload = multer({
      storage: storage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
          cb(null, true)
        } else {
          cb(new Error("Только изображения разрешены"))
        }
      },
    })

    // Проверка уникальности никнейма
    router.post("/check-nickname", async (req, res) => {
      try {
        const { nickname } = req.body

        if (!nickname) {
          return res.status(400).json({ error: "Никнейм не указан" })
        }

        const user = await this.db.getUser(nickname)
        res.json({ isUnique: !user })
      } catch (error) {
        console.error("Ошибка проверки никнейма:", error)
        res.status(500).json({ error: "Внутренняя ошибка сервера" })
      }
    })

    // Загрузка аватарки
    router.post("/upload-avatar", upload.single("avatar"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "Файл не загружен" })
        }

        // Обрабатываем изображение
        const filename = `avatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webp`
        const filepath = path.join(__dirname, "uploads", filename)

        await sharp(req.file.buffer).resize(100, 100).webp({ quality: 80 }).toFile(filepath)

        const avatarUrl = `/uploads/${filename}`

        res.json({
          success: true,
          avatarUrl: avatarUrl,
        })
      } catch (error) {
        console.error("Ошибка загрузки аватарки:", error)
        res.status(500).json({ error: "Ошибка загрузки аватарки" })
      }
    })

    // Получение пользователя
    router.get("/users/:nickname", async (req, res) => {
      try {
        const { nickname } = req.params
        const user = await this.db.getUser(nickname)

        if (!user) {
          return res.status(404).json({ error: "Пользователь не найден" })
        }

        // Не отправляем пароль
        const { password, ...userWithoutPassword } = user
        res.json(userWithoutPassword)
      } catch (error) {
        console.error("Ошибка получения пользователя:", error)
        res.status(500).json({ error: "Внутренняя ошибка сервера" })
      }
    })

    // Статистика сервера
    router.get("/stats", async (req, res) => {
      try {
        const dbStats = await this.db.getStats()
        res.json({
          server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
          },
          database: dbStats,
          websocket: this.wsHandler.getStats(),
          game: this.gameEngine.getGameStats(),
        })
      } catch (error) {
        console.error("Ошибка получения статистики:", error)
        res.status(500).json({ error: "Ошибка получения статистики" })
      }
    })

    return router
  }

  setupErrorHandling() {
    // 404 обработчик
    this.app.use((req, res) => {
      res.status(404).json({
        error: "Маршрут не найден",
        path: req.path,
        method: req.method,
      })
    })

    // Глобальный обработчик ошибок
    this.app.use((error, req, res, next) => {
      console.error("Необработанная ошибка:", error)
      res.status(500).json({
        error: "Внутренняя ошибка сервера",
        message: process.env.NODE_ENV === "development" ? error.message : undefined,
      })
    })
  }

  generateAdminPage() {
    const stats = {
      ...this.wsHandler.getStats(),
      ...this.gameEngine.getGameStats(),
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <title>🎭 Mafia Game Server - Anubis Admin Panel</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; color: white; margin-bottom: 30px; }
        .header h1 { font-size: 3em; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        .header p { font-size: 1.2em; opacity: 0.9; }
        .card { 
            background: white; 
            padding: 25px; 
            margin: 20px 0; 
            border-radius: 15px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
        .stat { 
            text-align: center; 
            padding: 25px; 
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white; 
            border-radius: 15px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: transform 0.3s ease;
        }
        .stat:hover { transform: translateY(-5px); }
        .stat-value { font-size: 2.5em; font-weight: bold; margin-bottom: 10px; }
        .stat-label { font-size: 1em; opacity: 0.9; }
        h2 { color: #667eea; border-bottom: 3px solid #667eea; padding-bottom: 10px; margin-bottom: 20px; }
        .btn { 
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white; 
            border: none; 
            padding: 12px 25px; 
            border-radius: 8px; 
            cursor: pointer;
            font-size: 1em;
            margin: 5px;
            transition: all 0.3s ease;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .logs { 
            background: #1a1a1a; 
            color: #00ff00; 
            padding: 20px; 
            border-radius: 8px; 
            font-family: 'Courier New
            padding: 20px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            max-height: 400px;
            overflow-y: auto;
            font-size: 0.9em;
        }
        .admin-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .control-group { background: #f8f9fa; padding: 20px; border-radius: 10px; }
        .control-group h3 { color: #667eea; margin-bottom: 15px; }
        input, select { 
            width: 100%; 
            padding: 10px; 
            margin: 5px 0; 
            border: 2px solid #ddd; 
            border-radius: 5px;
            font-size: 1em;
        }
        input:focus, select:focus { border-color: #667eea; outline: none; }
        .god-badge { 
            background: linear-gradient(45deg, #ffd700, #ffed4e);
            color: #333;
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            display: inline-block;
            margin-left: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎭 Mafia Game Server</h1>
            <p>Панель управления великого бога <span class="god-badge">👑 Anubis</span></p>
        </div>
        
        <div class="card">
            <h2>📊 Статистика сервера</h2>
            <div class="stats">
                <div class="stat">
                    <div class="stat-value">${stats.connectedUsers || 0}</div>
                    <div class="stat-label">Подключенных пользователей</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${stats.activeRooms || 0}</div>
                    <div class="stat-label">Активных комнат</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${stats.activeGames || 0}</div>
                    <div class="stat-label">Активных игр</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${Math.floor(process.uptime() / 60)}</div>
                    <div class="stat-label">Минут работы</div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>⚡ Божественные полномочия</h2>
            <div class="admin-controls">
                <div class="control-group">
                    <h3>💰 Управление монетами</h3>
                    <input type="text" id="coinUser" placeholder="Никнейм игрока">
                    <input type="number" id="coinAmount" placeholder="Количество монет">
                    <button class="btn" onclick="giveCoins()">Выдать монеты</button>
                    <button class="btn" onclick="takeCoins()">Забрать монеты</button>
                </div>
                
                <div class="control-group">
                    <h3>✨ Управление эффектами</h3>
                    <input type="text" id="effectUser" placeholder="Никнейм игрока">
                    <select id="effectType">
                        <option value="rainbow">🌈 Радуга</option>
                        <option value="glow">✨ Свечение</option>
                        <option value="shake">📳 Тряска</option>
                        <option value="bounce">⬆️ Подпрыгивание</option>
                        <option value="fade">👻 Затухание</option>
                    </select>
                    <button class="btn" onclick="giveEffect()">Выдать эффект</button>
                    <button class="btn" onclick="removeEffect()">Удалить эффект</button>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>🔧 Управление сервером</h2>
            <button class="btn" onclick="location.reload()">🔄 Обновить панель</button>
            <button class="btn" onclick="getStats()">📊 Получить статистику</button>
            <button class="btn" onclick="clearLogs()">🗑️ Очистить логи</button>
        </div>
        
        <div class="card">
            <h2>📝 Логи сервера</h2>
            <div id="logs" class="logs">
                ${new Date().toISOString()} - 🚀 Сервер запущен\\n
                ${new Date().toISOString()} - 🔌 WebSocket сервер активен\\n
                ${new Date().toISOString()} - 💾 База данных подключена\\n
                ${new Date().toISOString()} - 👑 Великий бог Anubis получил божественные права
            </div>
        </div>
    </div>
    
    <script>
        // Автообновление каждые 30 секунд
        setInterval(() => {
            location.reload();
        }, 30000);
        
        function giveCoins() {
            const user = document.getElementById('coinUser').value;
            const amount = parseInt(document.getElementById('coinAmount').value);
            
            if (!user || !amount) {
                alert('Заполните все поля');
                return;
            }
            
            fetch('/api/admin/give-coins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, amount })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert(\`Выдано \${amount} монет пользователю \${user}\`);
                    document.getElementById('coinUser').value = '';
                    document.getElementById('coinAmount').value = '';
                } else {
                    alert('Ошибка: ' + data.error);
                }
            })
            .catch(err => alert('Ошибка: ' + err));
        }
        
        function takeCoins() {
            const user = document.getElementById('coinUser').value;
            const amount = parseInt(document.getElementById('coinAmount').value);
            
            if (!user || !amount) {
                alert('Заполните все поля');
                return;
            }
            
            giveCoins(-amount);
        }
        
        function giveEffect() {
            const user = document.getElementById('effectUser').value;
            const effect = document.getElementById('effectType').value;
            
            if (!user || !effect) {
                alert('Заполните все поля');
                return;
            }
            
            fetch('/api/admin/give-effect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, effect })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert(\`Выдан эффект \${effect} пользователю \${user}\`);
                    document.getElementById('effectUser').value = '';
                } else {
                    alert('Ошибка: ' + data.error);
                }
            })
            .catch(err => alert('Ошибка: ' + err));
        }
        
        function removeEffect() {
            const user = document.getElementById('effectUser').value;
            const effect = document.getElementById('effectType').value;
            
            if (!user || !effect) {
                alert('Заполните все поля');
                return;
            }
            
            fetch('/api/admin/remove-effect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, effect })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert(\`Удалён эффект \${effect} у пользователя \${user}\`);
                    document.getElementById('effectUser').value = '';
                } else {
                    alert('Ошибка: ' + data.error);
                }
            })
            .catch(err => alert('Ошибка: ' + err));
        }
        
        function getStats() {
            fetch('/api/stats')
            .then(r => r.json())
            .then(data => {
                console.log('Статистика сервера:', data);
                alert('Статистика выведена в консоль');
            })
            .catch(err => alert('Ошибка: ' + err));
        }
        
        function clearLogs() {
            document.getElementById('logs').innerHTML = 
                new Date().toISOString() + ' - 🗑️ Логи очищены великим богом Anubis';
        }
    </script>
</body>
</html>
    `
  }

  async start() {
    try {
      // Инициализируем базу данных
      await this.db.init()
      console.log("✅ База данных инициализирована")

      // Запускаем сервер
      this.server.listen(this.port, () => {
        console.log(`🚀 Mafia Game Server запущен на порту ${this.port}`)
        console.log(`👑 Великий бог Anubis правит сервером!`)
        console.log(`📊 Админ панель: http://localhost:${this.port}/admin`)
        console.log(`🔌 WebSocket: ws://localhost:${this.port}`)
        console.log(`🌐 API: http://localhost:${this.port}/api`)
      })

      // Обработка сигналов завершения
      process.on("SIGTERM", () => this.shutdown())
      process.on("SIGINT", () => this.shutdown())
    } catch (error) {
      console.error("❌ Ошибка запуска сервера:", error)
      process.exit(1)
    }
  }

  async shutdown() {
    console.log("🛑 Завершение работы сервера...")

    try {
      // Закрываем WebSocket соединения
      this.wss.clients.forEach((client) => {
        client.close()
      })

      // Закрываем HTTP сервер
      this.server.close()

      // Закрываем базу данных
      await this.db.close()

      console.log("✅ Сервер успешно завершил работу")
      process.exit(0)
    } catch (error) {
      console.error("❌ Ошибка при завершении работы:", error)
      process.exit(1)
    }
  }
}

// Запуск сервера
if (require.main === module) {
  const server = new MafiaGameServer()
  server.start()
}

module.exports = MafiaGameServer
