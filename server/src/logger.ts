import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

const isProd = process.env.NODE_ENV === "production";

const transport = isProd
  ? undefined
  : pino.transport({
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss.l" },
    });

export const logger = transport ? pino({ level }, transport) : pino({ level });
