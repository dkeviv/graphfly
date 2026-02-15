function isoNow() {
  return new Date().toISOString();
}

export function createLogger({ service = 'graphfly', env = process.env } = {}) {
  const level = String(env.LOG_LEVEL ?? 'info').toLowerCase();
  const rank = (l) => {
    switch (l) {
      case 'debug':
        return 10;
      case 'info':
        return 20;
      case 'warn':
        return 30;
      case 'error':
      default:
        return 40;
    }
  };
  const min = rank(level);

  function emit(lvl, msg, fields) {
    if (rank(lvl) < min) return;
    const line = {
      ts: isoNow(),
      level: lvl,
      service,
      msg: String(msg ?? ''),
      ...((fields && typeof fields === 'object') ? fields : {})
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields)
  };
}

