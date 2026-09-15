"use strict";

const GRID_SIZE = 24;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const MOVE_INTERVAL_MS = 130;
const MAX_FOOD = 10;
const STORAGE_KEYS = {
  settings: "pixelSnake.settings",
  bestScore: "pixelSnake.bestScore"
};

const DEFAULT_SETTINGS = {
  pageBackgroundColor: "#1b1830",
  boardBackgroundColor: "#10222e",
  snakeHeadColor: "#fff06a",
  snakeBodyColor: "#56d68a",
  foodColor: "#ff5d73",
  borderColor: "#6ee7f5",
  foodIntervalSeconds: 2
};

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const KEY_DIRECTIONS = {
  KeyW: "up",
  KeyA: "left",
  KeyS: "down",
  KeyD: "right",
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowRight: "right"
};

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function pointsEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

function directionIsOpposite(a, b) {
  return DIRECTIONS[a].x + DIRECTIONS[b].x === 0 && DIRECTIONS[a].y + DIRECTIONS[b].y === 0;
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function clampFoodInterval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_SETTINGS.foodIntervalSeconds;
  }
  return Math.min(5, Math.max(0.5, Math.round(number * 10) / 10));
}

class SettingsStore {
  constructor() {
    this.settings = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) {
        return { ...DEFAULT_SETTINGS };
      }

      const stored = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...stored,
        foodIntervalSeconds: clampFoodInterval(stored.foodIntervalSeconds)
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings));
  }

  update(key, value) {
    this.settings[key] = key === "foodIntervalSeconds" ? clampFoodInterval(value) : value;
    this.save();
  }

  reset() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
  }
}

class SnakeGame {
  constructor(onChange) {
    this.onChange = onChange;
    this.bestScore = Number(localStorage.getItem(STORAGE_KEYS.bestScore)) || 0;
    this.moveTimer = null;
    this.foodTimer = null;
    this.foodIntervalMs = DEFAULT_SETTINGS.foodIntervalSeconds * 1000;
    this.resetState();
  }

  resetState() {
    this.snake = [
      { x: 8, y: 12 },
      { x: 7, y: 12 },
      { x: 6, y: 12 }
    ];
    this.foods = [];
    this.direction = "right";
    this.directionQueue = [];
    this.score = 0;
    this.status = "ready";
    this.message = {
      title: "准备好了",
      detail: "按开始游戏，或用 WASD 控制方向。"
    };
    this.emitChange();
  }

  setFoodInterval(seconds) {
    this.foodIntervalMs = clampFoodInterval(seconds) * 1000;
    if (this.status === "running") {
      this.scheduleFood();
    }
  }

  start() {
    if (this.status === "running") {
      return;
    }

    if (this.status === "ready" || this.status === "gameover" || this.status === "win") {
      this.resetState();
      this.addFood();
    }

    this.status = "running";
    this.message = { title: "", detail: "" };
    this.startMoveTimer();
    this.scheduleFood();
    this.emitChange();
  }

  restart() {
    this.stopTimers();
    this.resetState();
    this.addFood();
    this.status = "running";
    this.message = { title: "", detail: "" };
    this.startMoveTimer();
    this.scheduleFood();
    this.emitChange();
  }

  pause(reason = "游戏已暂停") {
    if (this.status !== "running") {
      return;
    }

    this.status = "paused";
    this.stopTimers();
    this.message = {
      title: "暂停",
      detail: reason
    };
    this.emitChange();
  }

  resume() {
    if (this.status !== "paused") {
      return;
    }

    this.status = "running";
    this.message = { title: "", detail: "" };
    this.startMoveTimer();
    this.scheduleFood();
    this.emitChange();
  }

  togglePause() {
    if (this.status === "running") {
      this.pause();
      return;
    }

    if (this.status === "paused") {
      this.resume();
    }
  }

  queueDirection(nextDirection) {
    if (!DIRECTIONS[nextDirection] || this.status !== "running") {
      return;
    }

    const lastDirection = this.directionQueue.at(-1) || this.direction;
    if (nextDirection === lastDirection || directionIsOpposite(lastDirection, nextDirection)) {
      return;
    }

    if (this.directionQueue.length < 2) {
      this.directionQueue.push(nextDirection);
    }
  }

  tick() {
    if (this.status !== "running") {
      return;
    }

    if (this.directionQueue.length > 0) {
      this.direction = this.directionQueue.shift();
    }

    const vector = DIRECTIONS[this.direction];
    const head = this.snake[0];
    const nextHead = { x: head.x + vector.x, y: head.y + vector.y };

    if (this.isOutsideGrid(nextHead)) {
      this.finish("gameover", "撞到边界", `最终得分：${this.score}`);
      return;
    }

    const eatenFoodIndex = this.foods.findIndex((food) => pointsEqual(food, nextHead));
    const willGrow = eatenFoodIndex !== -1;
    const collisionBody = willGrow ? this.snake : this.snake.slice(0, -1);

    if (collisionBody.some((part) => pointsEqual(part, nextHead))) {
      this.finish("gameover", "撞到自己", `最终得分：${this.score}`);
      return;
    }

    this.snake.unshift(nextHead);

    if (willGrow) {
      this.foods.splice(eatenFoodIndex, 1);
      this.score += 10;
      this.updateBestScore();
    } else {
      this.snake.pop();
    }

    if (this.snake.length >= CELL_COUNT) {
      this.finish("win", "胜利", `蛇已经占满地图，最终得分：${this.score}`);
      return;
    }

    this.emitChange();
  }

  addFood() {
    if (this.foods.length >= MAX_FOOD) {
      return false;
    }

    const occupied = new Set([
      ...this.snake.map(pointKey),
      ...this.foods.map(pointKey)
    ]);
    const available = [];

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const point = { x, y };
        if (!occupied.has(pointKey(point))) {
          available.push(point);
        }
      }
    }

    if (available.length === 0) {
      return false;
    }

    const nextFood = available[Math.floor(Math.random() * available.length)];
    this.foods.push(clonePoint(nextFood));
    this.emitChange();
    return true;
  }

  startMoveTimer() {
    clearInterval(this.moveTimer);
    this.moveTimer = setInterval(() => this.tick(), MOVE_INTERVAL_MS);
  }

  scheduleFood() {
    clearTimeout(this.foodTimer);
    this.foodTimer = setTimeout(() => {
      if (this.status !== "running") {
        return;
      }

      this.addFood();
      this.scheduleFood();
    }, this.foodIntervalMs);
  }

  stopTimers() {
    clearInterval(this.moveTimer);
    clearTimeout(this.foodTimer);
    this.moveTimer = null;
    this.foodTimer = null;
  }

  finish(status, title, detail) {
    this.status = status;
    this.stopTimers();
    this.directionQueue = [];
    this.message = { title, detail };
    this.emitChange();
  }

  updateBestScore() {
    if (this.score <= this.bestScore) {
      return;
    }

    this.bestScore = this.score;
    localStorage.setItem(STORAGE_KEYS.bestScore, String(this.bestScore));
  }

  isOutsideGrid(point) {
    return point.x < 0 || point.y < 0 || point.x >= GRID_SIZE || point.y >= GRID_SIZE;
  }

  emitChange() {
    if (typeof this.onChange === "function") {
      this.onChange(this);
    }
  }
}

class CanvasRenderer {
  constructor(canvas, settingsStore) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.settingsStore = settingsStore;
    this.cellSize = canvas.width / GRID_SIZE;
    this.context.imageSmoothingEnabled = false;
  }

  draw(game) {
    const settings = this.settingsStore.settings;
    document.documentElement.style.setProperty("--page-bg", settings.pageBackgroundColor);
    document.documentElement.style.setProperty("--border", settings.borderColor);

    this.context.imageSmoothingEnabled = false;
    this.context.fillStyle = settings.boardBackgroundColor;
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawGrid(settings.borderColor);
    this.drawFoods(game.foods, settings.foodColor);
    this.drawSnake(game.snake, settings.snakeHeadColor, settings.snakeBodyColor);
    this.drawBorder(settings.borderColor);
  }

  drawGrid(borderColor) {
    this.context.strokeStyle = this.withAlpha(borderColor, 0.22);
    this.context.lineWidth = 1;

    for (let i = 1; i < GRID_SIZE; i += 1) {
      const pos = i * this.cellSize + 0.5;
      this.context.beginPath();
      this.context.moveTo(pos, 0);
      this.context.lineTo(pos, this.canvas.height);
      this.context.stroke();

      this.context.beginPath();
      this.context.moveTo(0, pos);
      this.context.lineTo(this.canvas.width, pos);
      this.context.stroke();
    }
  }

  drawBorder(color) {
    this.context.strokeStyle = color;
    this.context.lineWidth = 8;
    this.context.strokeRect(4, 4, this.canvas.width - 8, this.canvas.height - 8);
  }

  drawFoods(foods, color) {
    this.context.fillStyle = color;
    foods.forEach((food) => {
      const x = food.x * this.cellSize;
      const y = food.y * this.cellSize;
      const pad = this.cellSize * 0.22;
      this.context.fillRect(x + pad, y + pad, this.cellSize - pad * 2, this.cellSize - pad * 2);
      this.context.fillStyle = "#ffffff";
      this.context.fillRect(x + this.cellSize * 0.35, y + this.cellSize * 0.28, 3, 3);
      this.context.fillStyle = color;
    });
  }

  drawSnake(snake, headColor, bodyColor) {
    snake.forEach((part, index) => {
      const x = part.x * this.cellSize;
      const y = part.y * this.cellSize;
      const inset = index === 0 ? 2 : 3;

      this.context.fillStyle = index === 0 ? headColor : bodyColor;
      this.context.fillRect(x + inset, y + inset, this.cellSize - inset * 2, this.cellSize - inset * 2);

      if (index === 0) {
        this.context.fillStyle = "#161225";
        this.context.fillRect(x + 6, y + 6, 4, 4);
        this.context.fillRect(x + this.cellSize - 10, y + 6, 4, 4);
      }
    });
  }

  withAlpha(hex, alpha) {
    const normalized = hex.replace("#", "");
    const value = parseInt(normalized, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
}

class UiController {
  constructor(game, renderer, settingsStore) {
    this.game = game;
    this.renderer = renderer;
    this.settingsStore = settingsStore;
    this.elements = {
      score: document.getElementById("scoreValue"),
      length: document.getElementById("lengthValue"),
      bestScore: document.getElementById("bestScoreValue"),
      statusText: document.getElementById("statusText"),
      overlay: document.getElementById("messageOverlay"),
      messageTitle: document.getElementById("messageTitle"),
      messageDetail: document.getElementById("messageDetail"),
      startButton: document.getElementById("startButton"),
      pauseButton: document.getElementById("pauseButton"),
      restartButton: document.getElementById("restartButton"),
      resetSettingsButton: document.getElementById("resetSettingsButton"),
      foodIntervalInput: document.getElementById("foodIntervalInput"),
      foodIntervalValue: document.getElementById("foodIntervalValue")
    };
    this.colorInputs = [
      "pageBackgroundColor",
      "boardBackgroundColor",
      "snakeHeadColor",
      "snakeBodyColor",
      "foodColor",
      "borderColor"
    ].map((id) => document.getElementById(id));

    this.bindEvents();
    this.syncSettingsControls();
    this.update(game);
  }

  bindEvents() {
    this.elements.startButton.addEventListener("click", () => this.game.start());
    this.elements.pauseButton.addEventListener("click", () => this.game.togglePause());
    this.elements.restartButton.addEventListener("click", () => this.game.restart());
    this.elements.resetSettingsButton.addEventListener("click", () => {
      this.settingsStore.reset();
      this.game.setFoodInterval(this.settingsStore.settings.foodIntervalSeconds);
      this.syncSettingsControls();
      this.update(this.game);
    });

    this.elements.foodIntervalInput.addEventListener("input", (event) => {
      const value = clampFoodInterval(event.target.value);
      this.settingsStore.update("foodIntervalSeconds", value);
      this.game.setFoodInterval(value);
      this.elements.foodIntervalValue.textContent = value.toFixed(1);
    });

    this.colorInputs.forEach((input) => {
      input.addEventListener("input", (event) => {
        this.settingsStore.update(input.id, event.target.value);
        this.update(this.game);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (this.isTypingTarget(event.target)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        this.game.togglePause();
        return;
      }

      const direction = KEY_DIRECTIONS[event.code];
      if (direction) {
        event.preventDefault();
        this.game.queueDirection(direction);
      }
    });

    window.addEventListener("blur", () => {
      this.game.pause("窗口失焦，已自动暂停。");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.game.pause("标签页不可见，已自动暂停。");
      }
    });
  }

  syncSettingsControls() {
    const settings = this.settingsStore.settings;
    this.colorInputs.forEach((input) => {
      input.value = settings[input.id];
    });
    this.elements.foodIntervalInput.value = String(settings.foodIntervalSeconds);
    this.elements.foodIntervalValue.textContent = settings.foodIntervalSeconds.toFixed(1);
  }

  update(game) {
    this.renderer.draw(game);
    this.elements.score.textContent = String(game.score);
    this.elements.length.textContent = String(game.snake.length);
    this.elements.bestScore.textContent = String(game.bestScore);
    this.elements.statusText.textContent = this.getStatusText(game.status);
    this.elements.pauseButton.textContent = game.status === "paused" ? "继续" : "暂停";

    const showOverlay = game.status !== "running";
    this.elements.overlay.classList.toggle("visible", showOverlay);
    this.elements.messageTitle.textContent = game.message.title;
    this.elements.messageDetail.textContent = game.message.detail;
  }

  getStatusText(status) {
    const labels = {
      ready: "准备开始",
      running: "游戏进行中",
      paused: "已暂停",
      gameover: "游戏结束",
      win: "胜利"
    };
    return labels[status] || "准备开始";
  }

  isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
  }
}

const settingsStore = new SettingsStore();
const canvas = document.getElementById("gameCanvas");
const renderer = new CanvasRenderer(canvas, settingsStore);
const game = new SnakeGame((currentGame) => {
  if (window.uiController) {
    window.uiController.update(currentGame);
  } else {
    renderer.draw(currentGame);
  }
});

game.setFoodInterval(settingsStore.settings.foodIntervalSeconds);
window.uiController = new UiController(game, renderer, settingsStore);
