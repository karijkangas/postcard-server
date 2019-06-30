/*
 *
 */

const { createLogger, format, transports } = require('winston');
const expressWinston = require('express-winston');

const httpLogger = expressWinston.logger({
  transports: [new transports.Console()],
  format: format.combine(format.colorize(), format.timestamp(), format.json()),
});

const logger = createLogger({
  format: format.combine(format.colorize(), format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

module.exports = {
  httpLogger,
  info: logger.log.bind(logger, 'info'),
  error: logger.log.bind(logger, 'error'),
};
