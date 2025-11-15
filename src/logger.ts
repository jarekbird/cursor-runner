import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Winston log levels
 */
type WinstonLogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';

/**
 * Configure Winston logger
 */
const logLevel: WinstonLogLevel = (process.env.LOG_LEVEL as WinstonLogLevel) || 'info';
const logFile: string = process.env.LOG_FILE || path.join(__dirname, '../logs/cursor-runner.log');

// Ensure logs directory exists
try {
  mkdirSync(path.dirname(logFile), { recursive: true });
} catch {
  // Directory might already exist, ignore error
}

export const logger: winston.Logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'cursor-runner' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
    // Write all logs to file
    new winston.transports.File({
      filename: logFile,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Handle uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.File({ filename: path.join(__dirname, '../logs/exceptions.log') })
);

logger.rejections.handle(
  new winston.transports.File({ filename: path.join(__dirname, '../logs/rejections.log') })
);
