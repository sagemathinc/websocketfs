import { callback } from "awaiting";
import SftpFuse from "./sftp-fuse";
import Fuse from "@cocalc/fuse-native";
import debug from "debug";

const log = debug("websocketfs:fuse:mount");

interface Options {
  path: string; // e.g., ./mnt
  remote: string; // e.g., websocket server -- ws://localhost:4389
}

export default async function mount(
  opts: Options,
): Promise<{ fuse: Fuse; client: SftpFuse }> {
  log("mount", opts);
  const { path, remote } = opts;

  const client = new SftpFuse(remote);
  await client.connect();
  const fuse = new Fuse(path, client, {
    debug: log.enabled,
    force: true,
    mkdir: true,
  });
  await callback(fuse.mount.bind(fuse));
  return { fuse, client };
}
