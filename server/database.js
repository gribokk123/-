const sqlite3 = require("sqlite3").verbose()
const path = require("path")

class Database {
  constructor() {
    this.db = null
    // Для Render используем /tmp для временных файлов
    this.dbPath = process.env.NODE_ENV === "production" ? "/tmp/mafia_game.db" : path.join(__dirname, "mafia_game.db")
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error("❌ Ошибка подключения к базе данных:", err)
          reject(err)
        } else {
          console.log("✅ Подключение к SQLite базе данных установлено")
          this.createTables().then(resolve).catch(reject)
        }
      })
    })
  }

  async createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT DEFAULT '👤',
        coins INTEGER DEFAULT 100,
        nickname_effects TEXT DEFAULT '[]',
        games_played INTEGER DEFAULT 0,
        games_won INTEGER DEFAULT 0,
        games_survived INTEGER DEFAULT 0,
        is_admin BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_nickname TEXT NOT NULL,
        min_players INTEGER NOT NULL,
        max_players INTEGER NOT NULL,
        roles TEXT NOT NULL,
        status TEXT DEFAULT 'waiting',
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        players TEXT NOT NULL,
        roles_distribution TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        winner TEXT,
        game_log TEXT DEFAULT '[]',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME
      )`,

      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        message_type TEXT DEFAULT 'chat',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_nickname TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_nickname TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ]

    for (const query of queries) {
      await this.runQuery(query)
    }

    // Создаем админа Anubis если его нет
    await this.createAnubisAdmin()
  }

  async createAnubisAdmin() {
    try {
      const anubis = await this.getUser("Anubis")
      if (!anubis) {
        await this.runQuery(
          `INSERT INTO users (nickname, password, coins, is_admin, avatar) 
           VALUES (?, ?, ?, ?, ?)`,
          ["Anubis", "anubis_god_password", 999999, 1, "👑"],
        )
        console.log("✅ Великий бог Anubis создан!")
      } else if (!anubis.is_admin) {
        await this.runQuery(`UPDATE users SET is_admin = 1, coins = 999999, avatar = '👑' WHERE nickname = ?`, [
          "Anubis",
        ])
        console.log("✅ Anubis получил божественные права!")
      }
    } catch (error) {
      console.error("Ошибка создания Anubis:", error)
    }
  }

  runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function (err) {
        if (err) {
          reject(err)
        } else {
          resolve({ id: this.lastID, changes: this.changes })
        }
      })
    })
  }

  getQuery(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) {
          reject(err)
        } else {
          resolve(row)
        }
      })
    })
  }

  allQuery(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }

  // Методы для пользователей
  async createUser(userData) {
    const { nickname, password, avatar = "👤" } = userData

    try {
      const result = await this.runQuery("INSERT INTO users (nickname, password, avatar) VALUES (?, ?, ?)", [
        nickname,
        password,
        avatar,
      ])

      return this.getUser(nickname)
    } catch (error) {
      if (error.message.includes("UNIQUE constraint failed")) {
        throw new Error("Пользователь с таким никнеймом уже существует")
      }
      throw error
    }
  }

  async getUser(nickname) {
    const user = await this.getQuery("SELECT * FROM users WHERE nickname = ?", [nickname])
    if (user && user.nickname_effects) {
      try {
        user.nickname_effects = JSON.parse(user.nickname_effects)
      } catch {
        user.nickname_effects = []
      }
    }
    return user
  }

  async loginUser(nickname, password) {
    const user = await this.getQuery("SELECT * FROM users WHERE nickname = ? AND password = ?", [nickname, password])

    if (user) {
      // Обновляем время последнего входа
      await this.runQuery("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE nickname = ?", [nickname])

      if (user.nickname_effects) {
        try {
          user.nickname_effects = JSON.parse(user.nickname_effects)
        } catch {
          user.nickname_effects = []
        }
      }
    }

    return user
  }

  async updateUserCoins(nickname, amount) {
    await this.runQuery("UPDATE users SET coins = coins + ? WHERE nickname = ?", [amount, nickname])
  }

  async updateUserStats(nickname, won = false, survived = false) {
    let query = "UPDATE users SET games_played = games_played + 1"
    const params = []

    if (won) {
      query += ", games_won = games_won + 1"
    }
    if (survived) {
      query += ", games_survived = games_survived + 1"
    }

    query += " WHERE nickname = ?"
    params.push(nickname)

    await this.runQuery(query, params)
  }

  async updateUserAvatar(nickname, avatar) {
    await this.runQuery("UPDATE users SET avatar = ? WHERE nickname = ?", [avatar, nickname])
  }

  async updateUserNicknameEffects(nickname, effects) {
    await this.runQuery("UPDATE users SET nickname_effects = ? WHERE nickname = ?", [JSON.stringify(effects), nickname])
  }

  // Админские методы
  async adminUpdateUserCoins(adminNickname, targetNickname, amount) {
    // Проверяем права админа
    const admin = await this.getUser(adminNickname)
    if (!admin || !admin.is_admin) {
      throw new Error("Недостаточно прав")
    }

    await this.updateUserCoins(targetNickname, amount)

    // Логируем действие
    await this.runQuery(
      "INSERT INTO admin_actions (admin_nickname, action_type, target_nickname, details) VALUES (?, ?, ?, ?)",
      [adminNickname, "coins_update", targetNickname, `Изменение монет: ${amount}`],
    )
  }

  async adminUpdateUserEffects(adminNickname, targetNickname, effects) {
    const admin = await this.getUser(adminNickname)
    if (!admin || !admin.is_admin) {
      throw new Error("Недостаточно прав")
    }

    await this.updateUserNicknameEffects(targetNickname, effects)

    await this.runQuery(
      "INSERT INTO admin_actions (admin_nickname, action_type, target_nickname, details) VALUES (?, ?, ?, ?)",
      [adminNickname, "effects_update", targetNickname, `Обновление эффектов: ${JSON.stringify(effects)}`],
    )
  }

  // Методы для комнат
  async createRoom(roomData) {
    const { id, name, creator, minPlayers, maxPlayers, roles, password } = roomData

    await this.runQuery(
      "INSERT INTO rooms (id, name, creator_nickname, min_players, max_players, roles, password) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, creator.nickname, minPlayers, maxPlayers, JSON.stringify(roles), password],
    )
  }

  async getRooms() {
    const rooms = await this.allQuery('SELECT * FROM rooms WHERE status = "waiting" ORDER BY created_at DESC')

    return rooms.map((room) => ({
      ...room,
      roles: JSON.parse(room.roles),
      hasPassword: !!room.password,
    }))
  }

  async getRoom(roomId) {
    const room = await this.getQuery("SELECT * FROM rooms WHERE id = ?", [roomId])
    if (room && room.roles) {
      room.roles = JSON.parse(room.roles)
    }
    return room
  }

  async deleteRoom(roomId) {
    await this.runQuery("DELETE FROM rooms WHERE id = ?", [roomId])
  }

  async updateRoomStatus(roomId, status) {
    await this.runQuery("UPDATE rooms SET status = ? WHERE id = ?", [status, roomId])
  }

  // Методы для игр
  async startGame(roomId, gameData) {
    const gameId = "game_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9)

    await this.runQuery("INSERT INTO games (id, room_id, players, roles_distribution) VALUES (?, ?, ?, ?)", [
      gameId,
      roomId,
      JSON.stringify(gameData.players),
      JSON.stringify(gameData.roles),
    ])

    await this.updateRoomStatus(roomId, "playing")
    return gameId
  }

  async endGame(gameId, winner, gameLog = []) {
    await this.runQuery(
      'UPDATE games SET status = "finished", winner = ?, game_log = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?',
      [winner, JSON.stringify(gameLog), gameId],
    )
  }

  // Методы для сообщений
  async saveMessage(messageData) {
    const { roomId, sender, message, messageType = "chat", timestamp } = messageData

    await this.runQuery(
      "INSERT INTO messages (room_id, sender, message, message_type, timestamp) VALUES (?, ?, ?, ?, ?)",
      [roomId, sender, message, messageType, timestamp],
    )
  }

  async getRoomMessages(roomId, limit = 50) {
    return this.allQuery("SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?", [roomId, limit])
  }

  // Статистика
  async getStats() {
    const totalUsers = await this.getQuery("SELECT COUNT(*) as count FROM users")
    const totalGames = await this.getQuery("SELECT COUNT(*) as count FROM games")
    const activeRooms = await this.getQuery('SELECT COUNT(*) as count FROM rooms WHERE status = "waiting"')

    return {
      totalUsers: totalUsers.count,
      totalGames: totalGames.count,
      activeRooms: activeRooms.count,
    }
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error("Ошибка закрытия базы данных:", err)
          } else {
            console.log("✅ База данных закрыта")
          }
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}

module.exports = Database
