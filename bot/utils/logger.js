/**
 * FLASHLOAN-AI: Logger Module
 * Logging voi timestamps, colors, va log levels
 */

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bold: "\x1b[1m",
};

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SUCCESS: 4,
};

class Logger {
  constructor(options = {}) {
    this.module = options.module || "SYSTEM";
    this.level = LOG_LEVELS[options.level] ?? LOG_LEVELS.DEBUG;
    this.showTimestamp = options.showTimestamp !== false;
  }

  _getTimestamp() {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toTimeString().split(" ")[0];
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    return `${date} ${time}.${ms}`;
  }

  _format(level, color, message, data) {
    const ts = this.showTimestamp
      ? `${COLORS.gray}[${this._getTimestamp()}]${COLORS.reset} `
      : "";
    const mod = `${COLORS.cyan}[${this.module}]${COLORS.reset}`;
    const lvl = `${color}[${level}]${COLORS.reset}`;
    let line = `${ts}${mod} ${lvl} ${message}`;
    if (data !== undefined) {
      line +=
        " " +
        COLORS.gray +
        (typeof data === "object" ? JSON.stringify(data) : String(data)) +
        COLORS.reset;
    }
    return line;
  }

  debug(message, data) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(this._format("DEBUG", COLORS.gray, message, data));
    }
  }

  info(message, data) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(this._format("INFO", COLORS.blue, message, data));
    }
  }

  warn(message, data) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(this._format("WARN", COLORS.yellow, message, data));
    }
  }

  error(message, data) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(this._format("ERROR", COLORS.red, message, data));
    }
  }

  success(message, data) {
    console.log(this._format("OK", COLORS.green, message, data));
  }

  profit(message, data) {
    console.log(
      this._format(
        "PROFIT",
        `${COLORS.bold}${COLORS.green}`,
        message,
        data
      )
    );
  }

  alert(message, data) {
    console.log(
      this._format(
        "ALERT",
        `${COLORS.bold}${COLORS.bgRed}${COLORS.white}`,
        message,
        data
      )
    );
  }

  banner(title) {
    const line = "=".repeat(50);
    console.log(`\n${COLORS.cyan}${line}`);
    console.log(`  ${title}`);
    console.log(`${line}${COLORS.reset}\n`);
  }

  table(data) {
    if (Array.isArray(data) && data.length > 0) {
      console.table(data);
    }
  }

  child(module) {
    return new Logger({
      module,
      level: Object.keys(LOG_LEVELS).find(
        (k) => LOG_LEVELS[k] === this.level
      ),
      showTimestamp: this.showTimestamp,
    });
  }
}

function createLogger(module, options = {}) {
  return new Logger({ module, ...options });
}

module.exports = { Logger, createLogger, LOG_LEVELS, COLORS };
