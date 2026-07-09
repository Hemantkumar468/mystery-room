import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from './index.js';

const logDir = path.resolve(process.cwd(), config.log.dir);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

/** Human-friendly console format for local development. */
const devConsoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} ${level} ${stack || message}${rest}`;
  }),
);

/** Structured JSON for files / production log shippers. */
const fileFormat = combine(timestamp(), errors({ stack: true }), splat(), json());

const transports = [
  new winston.transports.Console({
    format: config.isProd ? fileFormat : devConsoleFormat,
  }),
];

// Rotating file transports — kept out of test runs to avoid noise/disk churn.
if (!config.isTest) {
  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
      format: fileFormat,
    }),
    new DailyRotateFile({
      level: 'error',
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
      format: fileFormat,
    }),
  );
}

export const logger = winston.createLogger({
  level: config.log.level,
  levels: winston.config.npm.levels,
  defaultMeta: { service: 'mysteryrooms-erp' },
  transports,
  exitOnError: false,
});

/** Morgan writes HTTP access lines through here so all logs share one pipeline. */
export const httpLogStream = {
  write: (message) => logger.http(message.trim()),
};

export default logger;
