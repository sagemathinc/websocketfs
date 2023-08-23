/*
Implement a inefficient version of "bind" over wsftp and a websocket,
for testing and dev purposes only.
*/

import mount from "./mount";
import serve from "./serve";
import debug from "debug";

const log = debug("websocketfs:fuse:bind");

export default async function bind(source: string, target: string) {
  const { port, server } = await serve({ path: source });
  const remote = `ws://localhost:${port}`;
  const { fuse, client, unmount } = await mount({ path: target, remote });
  log("mounted websocketfs on localhost:", source, "-->", target);
  return {
    unmount: async () => {
      await unmount();
      server.end();
    },
    fuse,
    server,
    client,
  };
}
