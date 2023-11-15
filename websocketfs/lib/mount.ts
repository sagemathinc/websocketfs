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
  // If the metadataFile file path is given, we poll it for modification every few seconds.
  // If it changes, the file is read into memory and used to provide ALL directory and
  // file stat information until cacheTimeout or the file is udpated.
  // The format of metadataFile alternates with one file path then one line of stat info about it:
  //    [filename-relative-to-mount-point] (with NO leading /.!)
  //    [mtime in seconds] [atime in seconds] [number of 512-byte blocks] [size] [mode in octal]
  // Here all of mtime, atime, blocks, size are decimal numbers, which may have a fractional part,
  // and mode is in base 8.  E.g., this find command does it:
  //        find . -printf "%p\n%T@ %A@ %b %s 0%m\n"
  // If metadataFile ends in .lz4 it is assumed to be lz4 compressed and gets automatically decompressed.
  //
  metadataFile?: string;
  // Any stat to a path that starts with hidePath gets an instant
  // response that the the path does not exists, instead of having to
  // possibly use sftp. This is absolute according to the mount, i.e.,
  // if you want .unionfs* at the top to be ignored, then use '/.unionfs'.
  hidePath?: string;
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
    metadataFile,
    hidePath,
  } = opts;

  const client = new SftpFuse(remote, {
    cacheTimeout,
    reconnect,
    cacheStatTimeout,
    cacheDirTimeout,
    cacheLinkTimeout,
    readTracking,
    metadataFile,
    hidePath,
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
