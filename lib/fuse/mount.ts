import { callback } from "awaiting";
import SftpFuse from "./sftp-fuse";
import Fuse from "fuse-native";
import debug from "debug";

const log = debug("websocketfs:fuse:mount");

interface Options {
  path: string; // e.g., ./mnt
  remote: string; // e.g., websocket server -- ws://localhost:4389
}

export default async function mount(opts: Options) {
  log("mount", opts);
  const { path, remote } = opts;

  const sftpFuseClient = new SftpFuse(remote);
  await sftpFuseClient.connect();
  const fuse = new Fuse(path, sftpFuseClient, {
    debug: log.enabled,
    force: true,
    mkdir: true,
  });
  await callback(fuse.mount.bind(fuse));
}
