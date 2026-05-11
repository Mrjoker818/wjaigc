const http = require('http');
const { parse } = require('url');
const next = require('next');

const port = Number.parseInt(process.env.PORT || '5000', 10);
const hostname = process.env.WUJIE_HOST || '0.0.0.0';
const dev = false;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '', true);
      await handle(req, res, parsedUrl);
    } catch (error) {
      console.error('Request handling failed:', error);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  server.listen(port, hostname, () => {
    const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
    console.log(`> Server ready at http://${displayHost}:${port}`);
  });
});
