/*
Implement a inefficient version of "bind" over wsftp and a websocket,
for testing and dev purposes only.
*/

import { Server as SftpServer } from "../sftp/sftp";
import getPort from "port-get";
import mount from "./mount";
import debug from "debug";
import { callback } from "awaiting";

const log = debug("websocketfs:fuse:bind");

export default async function bind(source: string, target: string) {
  const { port, server } = await startServer(source);
  const remote = `ws://localhost:${port}`;
  const { fuse, client } = await mount({ path: target, remote });
  log("mounted websocketfs on localhost:", source, "-->", target);
  return {
    unmount: async () => {
      await callback(fuse.unmount.bind(fuse));
      client.end();
      server.end();
    },
    fuse,
    server,
    client,
  };
}

async function startServer(
  virtualRoot: string,
): Promise<{ port: number; server: SftpServer }> {
  // get an available port
  const port = await getPort();

  // start SFTP server on localhost
  const server = new SftpServer({
    host: "localhost",
    port,
    virtualRoot,
//     perMessageDeflate: {
//       zlibDeflateOptions: {
//         // See zlib defaults.
//         chunkSize: 1024,
//         memLevel: 7,
//         level: 3,
//       },
//       zlibInflateOptions: {
//         chunkSize: 10 * 1024,
//       },
//       // Other options settable:
//       clientNoContextTakeover: true, // Defaults to negotiated value.
//       serverNoContextTakeover: true, // Defaults to negotiated value.
//       serverMaxWindowBits: 10, // Defaults to negotiated value.
//       // Below options specified as default values.
//       concurrencyLimit: 10, // Limits zlib concurrency for perf.
//       threshold: 1024, // Size (in bytes) below which messages
//       // should not be compressed if context takeover is disabled.
//     },
  });
  log("SFTP server listening on port ", port);

  return { port, server };
}
