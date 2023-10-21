import { callback } from "awaiting";
import SftpFuse, { IClientOptions } from "./sftp-fuse";
import Fuse from "@cocalc/fuse-native";
import debug from "debug";

const log = debug("websocketfs:mount");

interface Options {
  path: string; // e.g., ./mnt
  remote: string; // e.g., websocket server -- ws://localhost:4389
  // NOTE: we change some options from the defaults, but you can set anything
  // explicitly via mountOptions, overriding our non-default options.
  // One is that we set the uid and gid of the client user by default.
  mountOptions?: Fuse.OPTIONS;
  connectOptions?: IClientOptions;
  reconnect?: boolean;
  cacheTimeout?: number;
  cacheStatTimeout?: number;
  cacheDirTimeout?: number;
  cacheLinkTimeout?: number;
  // write out to path all files explicitly read in the last timeout seconds.
  // path is updated once every update seconds.
  readTracking?: { path: string; timeout?: number; update?: number };
}

export default async function mount(
  opts: Options,
): Promise<{ fuse: Fuse; client: SftpFuse; unmount: () => Promise<void> }> {
  log("mount", opts);
  const {
    path,
    remote,
    connectOptions,
    mountOptions,
    reconnect,
    cacheTimeout,
    cacheStatTimeout,
    cacheDirTimeout,
    cacheLinkTimeout,
    readTracking,
  } = opts;

  const client = new SftpFuse(remote, {
    cacheTimeout,
    reconnect,
    cacheStatTimeout,
    cacheDirTimeout,
    cacheLinkTimeout,
    readTracking,
  });
  await client.connect(connectOptions);
  const fuse = new Fuse(path, client, {
    debug: log.enabled,
    force: true,
    mkdir: true,
    fsname: remote,
    autoUnmount: true, // doesn't seem to work, hence the process exit hook below.
    uid: process.getuid?.(),
    gid: process.getgid?.(),
    ...mountOptions,
  });
  await callback(fuse.mount.bind(fuse));
  const unmount = async () => {
    log("unmounting", opts);
    await callback(fuse.unmount.bind(fuse));
    client.end();
  };
  process.once("exit", (code) => {
    log("fuse unmount on exit");
    fuse.unmount(() => {});
    process.exit(code);
  });
  return { fuse, client, unmount };
}
