export const config = {
  api: { bodyParser: false },
};

import server from '../dist/server/server.js';

export default async function handler(req, res) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', protocol + '://' + host);
  
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach(v => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }

  const init = { method: req.method, headers };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = new ReadableStream({
      start(controller) {
        req.on('data', chunk => controller.enqueue(chunk));
        req.on('end', () => controller.close());
        req.on('error', err => controller.error(err));
      }
    });
    init.duplex = 'half';
  }

  const webReq = new Request(url, init);
  
  try {
    const webRes = await server.fetch(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    
    if (webRes.body) {
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.end();
    }
  } catch (error) {
    console.error('SSR Error:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

