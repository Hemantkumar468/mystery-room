const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) console.error('[WhatsApp Check]', err);

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(err.details ? { error: err.details } : {}),
  });
};

module.exports = { notFound, errorHandler };
