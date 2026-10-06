const staticAssetPattern = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|txt)$/i;
const quietPaths = new Set(['/favicon.ico', '/api/health']);

function shouldLog(req, res) {
  if (process.env.LOG_REQUESTS === 'false') return false;
  const pathname = (req.originalUrl || req.url || '/').split('?')[0];
  if (res.statusCode >= 400) return true;
  if (quietPaths.has(pathname)) return false;
  return !staticAssetPattern.test(pathname);
}

function logLine(level, message) {
  console.log(`[${new Date().toISOString()}] ${level} ${message}`);
}

function requestLogger() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (!shouldLog(req, res)) return;
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      const status = res.statusCode;
      const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      const url = (req.originalUrl || req.url || '/').slice(0, 300);
      const user = req.session?.userId || '-';
      const role = req.session?.role || '-';
      const size = res.getHeader('content-length');
      const bytes = Number(size) > 0 ? ` bytes=${size}` : '';
      logLine(level, `${req.method} ${url} ${status} ${duration.toFixed(1)}ms user=${user} role=${role} ip=${req.ip || '-'}${bytes}`);
    });
    next();
  };
}

function logError(req, error) {
  if (process.env.LOG_REQUESTS === 'false') return;
  const url = (req?.originalUrl || req?.url || '-').slice(0, 300);
  const code = error?.code ? `${error.code} ` : '';
  const detail = (error?.stack || error?.message || String(error)).split('\n').slice(0, 8).join('\n');
  logLine('ERROR', `${req?.method || '-'} ${url} ${code}${detail}`);
}

module.exports = { logError, requestLogger };
