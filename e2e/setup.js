const { createApp } = require('../server');

// Own the server directly so teardown is portable, including restricted Windows shells.
module.exports = async () => {
  const { server } = createApp({ env: {} });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3173, '127.0.0.1', resolve);
  });
  return () =>
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
};
