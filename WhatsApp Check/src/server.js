const app = require('./app');
const config = require('./config/env');

const server = app.listen(config.port, () => {
  console.log('----------------------------------------------------');
  console.log(` WhatsApp Check running on http://localhost:${config.port}`);
  console.log(` Graph API version : ${config.graphVersion}`);
  console.log(` Phone Number ID   : ${config.phoneNumberId || '(not set in .env - pass it in the request body)'}`);
  console.log(` Access token      : ${config.accessToken ? 'loaded from .env' : '(not set - pass it in the request body)'}`);
  console.log('----------------------------------------------------');
});

const shutdown = (signal) => () => {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
