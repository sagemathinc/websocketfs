import { callback } from "awaiting";
import SftpFuse from "./sftp-fuse";
import Fuse from "@cocalc/fuse-native";
import debug from "debug";

const log = debug("websocketfs:mount");

interface Options {
  path: string; // e.g., ./mnt
  remote: string; // e.g., websocket server -- ws://localhost:4389
  // NOTE: we change some options from the defaults, but you can set anything
  // explicitly via mountOpts, overriding our non-default options.
  mountOpts?: Fuse.OPTIONS;
}

export default async function mount(
  opts: Options,
): Promise<{ fuse: Fuse; client: SftpFuse; unmount: () => Promise<void> }> {
  log("mount", opts);
  const { path, remote, mountOpts } = opts;

  const client = new SftpFuse(remote);
  await client.connect();
  const fuse = new Fuse(path, client, {
    debug: log.enabled,
    force: true,
    mkdir: true,
    fsname: remote,
    autoUnmount: true,
    ...mountOpts,
  });
  await callback(fuse.mount.bind(fuse));
  const unmount = async () => {
    await callback(fuse.unmount.bind(fuse));
    client.end();
  };
  return { fuse, client, unmount };
}
