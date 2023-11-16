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

  // Read Tracking
  // write out to path all files explicitly read in the last timeout seconds.
  // path is updated once every update seconds.
  readTracking?: { path: string; timeout?: number; update?: number };

  // Metadata
  // If the metadataFile file path is given, we poll it for modification every few seconds.
  // If it changes, the file is read into memory and used to provide ALL directory and
  // file stat information until the file is updated.  If it is deleted, caching stops.
  // The format of metadataFile is as follows with a NULL character beetween the filename and the metadata.
  //    [filename-relative-to-mount-point-no-leading-/.]\0[mtime in seconds] [atime in seconds] [number of 512-byte blocks] [size] [symbolic mode string]\0\0
  // This file is *not* assumed to be sorted (it's a 1-line file, so hard to sort in unix anyways).
  // Here all of mtime, atime, blocks, size are decimal numbers, which may have a fractional part,
  // and mode is a string like in ls.  E.g., this find command does it (ignoring hidden files)::
  //
  //       mkdir -p /tmp/meta; find * -printf "%p\0%T@ %A@ %b %s %M\0\0" | lz4 > .meta.lz4 && mv .meta.lz4  /tmp/meta/meta.lz4
  //
  // PATCHES: (This does not exist yet!) If metadataFile ends in .lz4 it is assumed to be lz4 compressed and gets automatically decompressed.
  // If there are files metadataFile.patch.[n] (with n an integer), then they are diff-match-patch patches
  // in the internal cocalc compressed format, that should be applied in order to metadataFile to get
  // the current version of the file.  This is needed to dramatically reduce bandwidth usage.
  // The patch files can optionally end in .lz4.
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
