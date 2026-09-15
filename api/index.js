export const config = { runtime: 'edge' }; import server from '../dist/server/server.js'; export default async function (request, event) { return server.fetch(request, process.env, event); }
