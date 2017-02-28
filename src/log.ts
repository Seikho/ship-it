import * as chalk from 'chalk'

export function debug(message: string) {
  return log('DEBUG', message, chalk.gray)
}

export function info(message: string) {
  return log('INFO', message, chalk.blue)
}

export function warn(message: string) {
  return log('WARN', message, chalk.yellow)
}

export function error(message: string) {
  return log('ERROR', message, chalk.red)
}

function log(prefix: string, message: string, colour: chalk.ChalkChain) {
  const timestamp = new Date().toTimeString().slice(0, 8)

  const logLevel = getLogLevel(process.env.LOG_LEVEL || 'debug')
  const targetLevel = getLogLevel(prefix)

  if (targetLevel >= logLevel) {
    console.log('[%s] %s: %s', timestamp, colour(prefix), message)
  }
}

function getLogLevel(level: string): number {
  switch (level.toLowerCase()) {
    case 'debug':
      return 10
    case 'info':
      return 20
    case 'warn':
      return 30
    case 'error':
      return 40
    default:
      return 0
  }
}

export function stringify(object: Object): string {
  try {
    return JSON.stringify(object, null, 2)
  } catch (ex) {
    return object.toString()
  }
}