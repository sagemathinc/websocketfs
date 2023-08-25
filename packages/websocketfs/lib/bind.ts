import mount from "./mount";
import serve from "./serve";
import debug from "debug";

const log = debug("websocketfs:fuse:bind");

export default async function bind(source: string, target: string) {
  const { port, server } = await serve({ path: source });
  const remote = `ws://localhost:${port}`;
  const { fuse, client, unmount } = await mount({ path: target, remote });
  log("mounted websocketfs on localhost:", source, "-->", target);

  const exitHandler = async () => {
    server.end();
    await unmount();
    if (process.env.JEST_WORKER_ID == null) {
      process.exit();
    }
  };

  process.on("exit", exitHandler);
  process.on("SIGINT", exitHandler);
  process.on("SIGTERM", exitHandler);

  return {
    unmount: async () => {
      server.end();
      await unmount();
    },
    fuse,
    server,
    client,
  };
}
