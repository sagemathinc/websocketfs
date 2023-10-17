/*

Some relevant docs:
- https://libfuse.github.io/doxygen/structfuse__operations.html
- https://github.com/direktspeed/node-fuse-bindings
- https://filezilla-project.org/specs/draft-ietf-secsh-filexfer-02.txt
//
*/
import { Client as SftpClient, IClientOptions } from "websocket-sftp/lib/sftp";
import { RenameFlags } from "websocket-sftp/lib/fs-api";
import type { SftpError } from "websocket-sftp/lib/util";
import {
  MAX_WRITE_BLOCK_LENGTH,
  MAX_READ_BLOCK_LENGTH,
} from "websocket-sftp/lib/sftp-client";
import { callback, delay } from "awaiting";
import { bindMethods } from "./util";
import { convertOpenFlags } from "./flags";
import Fuse from "@cocalc/fuse-native";
import debug from "debug";
import TTLCache from "@isaacs/ttlcache";
import { dirname, join } from "path";

export type { IClientOptions };

const log = debug("websocketfs:sftp-fuse");

type Callback = Function;

type State = "init" | "connecting" | "ready" | "closed";

const MAX_RECONNECT_DELAY_MS = 7500;
const RECONNECT_DELAY_GROW = 1.3;

// the cache names are to match with sshfs options.

interface Options {
  // cacheTimeout -- used for anything not explicitly specified; defaults to 20s, same as sshfs.  In seconds!
  cacheTimeout?: number;
  cacheStatTimeout?: number; // in seconds (to match sshfs)
  cacheDirTimeout?: number;
  cacheLinkTimeout?: number;
  // reconnect -- defaults to true; if true, automatically reconnects
  // to server when connection breaks.
  reconnect?: boolean;
}

export default class SftpFuse {
  private state: State = "init";
  private remote: string;
  private sftp: SftpClient;
  private data: {
    [fd: number]: { buffer: Buffer; position: number }[];
  } = {};
  private attrCache: TTLCache<string, any> | null = null;
  private dirCache: TTLCache<string, string[]> | null = null;
  private linkCache: TTLCache<string, string> | null = null;
  private connectOptions?: IClientOptions;
  private reconnect: boolean;

  constructor(remote: string, options: Options = {}) {
    this.remote = remote;
    const {
      cacheTimeout = 20,
      cacheStatTimeout,
      cacheDirTimeout,
      cacheLinkTimeout,
      reconnect = true,
    } = options;
    if (cacheStatTimeout ?? cacheTimeout) {
      log(
        "enabling attrCache with timeout",
        cacheStatTimeout ?? cacheTimeout,
        "seconds",
      );
      this.attrCache = new TTLCache({
        ttl: (cacheStatTimeout ?? cacheTimeout) * 1000,
      });
    }
    if (cacheDirTimeout ?? cacheTimeout) {
      log(
        "enabling dirCache with timeout",
        cacheDirTimeout ?? cacheTimeout,
        "seconds",
      );
      this.dirCache = new TTLCache({
        ttl: (cacheDirTimeout ?? cacheTimeout) * 1000,
      });
    }
    if (cacheLinkTimeout ?? cacheTimeout) {
      log(
        "enabling linkCache with timeout",
        cacheLinkTimeout ?? cacheTimeout,
        "seconds",
      );
      this.linkCache = new TTLCache({
        ttl: (cacheLinkTimeout ?? cacheTimeout) * 1000,
      });
    }
    this.reconnect = reconnect;
    bindMethods(this);
  }

  async handleConnectionClose(err) {
    log("connection closed", err);
    // @ts-ignore
    delete this.sftp;
    this.state = "init";
    if (!this.reconnect) {
      return;
    }
    let d = 1000;
    while (true) {
      await delay(d);
      try {
        await this.connectToServer();
        log("successfully connected!");
        return;
      } catch (err) {
        log("failed to connect", err);
        if (d <= MAX_RECONNECT_DELAY_MS) {
          d = Math.min(MAX_RECONNECT_DELAY_MS, d * RECONNECT_DELAY_GROW);
        }
      }
    }
  }

  async connect(options?: IClientOptions) {
    this.connectOptions = options;
    try {
      await this.connectToServer();
    } catch (err) {
      this.handleConnectionClose(err);
    }
  }

  private async connectToServer() {
    if (this.state != "init") {
      throw Error(
        `can only connect when in init state, but state is ${this.state}`,
      );
    }
    try {
      this.state = "connecting";
      log("connecting to ", this.remote);
      const sftp = new SftpClient();
      bindMethods(sftp);
      await callback(sftp.connect, this.remote, this.connectOptions ?? {});
      sftp.on("close", this.handleConnectionClose);
      this.sftp = sftp;
      this.state = "ready";
    } catch (err) {
      this.state = "init";
      throw err;
    }
  }

  end() {
    log("ending connection to", this.remote);
    this.sftp?.end();
    // @ts-ignore
    delete this.sftp;
    this.state = "closed";
  }

  //
  // Everything below is implementing the FUSE api
  //

  init(cb) {
    log("Filesystem init");
    cb(0);
  }

  //   access(path: string, mode: number, cb) {
  //     log("access", path, mode);
  //     // TODO
  //     cb(0);
  //   }

  private isNotReady(cb) {
    if (this.state != "ready") {
      cb(Fuse.ENOTCONN);
      return true;
    }
    return false;
  }

  statfs(path: string, cb) {
    if (this.isNotReady(cb)) return;
    // this gets called, e.g., when you do "df"
    log("statfs", path);
    this.sftp.statvfs(path, fuseError(cb));
  }

  getattr(path: string, cb) {
    if (this.isNotReady(cb)) return;
    log("getattr", path);
    if (this.attrCache?.has(path)) {
      const { errno, attr } = this.attrCache.get(path);
      cb(errno ?? 0, attr);
      return;
    }
    log("getattr -- not using cache", path);
    this.sftp.lstat(path, (err, attr) => {
      // log("getattr -- lstat", { path, err, attr });
      if (err) {
        this.processAttr(path, err);
        fuseError(cb)(err);
      } else {
        // console.log({ path, attr });
        // ctime isn't part of the sftp protocol, so we set it to mtime, which
        // is what sshfs does.  This isn't necessarily correct, but it's what
        // we do, e.g., ctime should change if you change file permissions, but
        // won't in this case.  We could put ctime in the metadata though.
        cb(0, this.processAttr(path, err, attr));
      }
    });
  }

  fgetattr(path: string, fd: number, cb) {
    if (this.isNotReady(cb)) return;
    log("fgetattr", { path, fd });
    if (this.attrCache?.has(path)) {
      const { errno, attr } = this.attrCache.get(path);
      cb(errno ?? 0, attr);
      return;
    }
    const handle = this.sftp.fileDescriptorToHandle(fd);
    this.sftp.fstat(handle, (err, attr) => {
      if (err) {
        this.processAttr(path, err);
        fuseError(cb)(err);
      } else {
        // see comment about ctime above.
        cb(0, this.processAttr(path, err, attr));
      }
    });
  }

  private processAttr(path: string, err, attr?) {
    if (attr == null) {
      if (this.attrCache != null) {
        this.attrCache.set(path, { errno: getErrno(err) });
      }
      return;
    }
    attr = {
      ...attr,
      ctime: attr.mtime,
      blocks: attr.metadata?.blocks ?? 0,
    };
    if (this.attrCache != null) {
      this.attrCache.set(path, { attr });
    }
    return attr;
  }

  async flush(path: string, fd: number, cb) {
    if (this.isNotReady(cb)) return;
    let data = this.data[fd];
    log("flush", { path, fd, packets: data?.length ?? 0 });
    if (data == null) {
      // nothing to do
      cb(0);
      return;
    }
    delete this.data[fd];
    this.clearCache(path);
    try {
      while (data.length > 0) {
        let { buffer, position } = data.shift()!;
        //console.log("grabbed ", { n: buffer.length, position });
        //console.log("next is ", { position: data[0]?.position });
        while (
          data.length > 0 &&
          data[0].position == buffer.length + position
        ) {
          //console.log("combining...");
          buffer = Buffer.concat([buffer, data[0].buffer]);
          data.shift();
        }
        //console.log("now writing out");
        await this.writeToDisk(fd, buffer, buffer.length, position);
      }
      cb(0);
    } catch (err) {
      if (err.errno == -2) {
        // sometimes this happens when flush after fd
        // is no longer available.  Not sure why. E.g., when starting sage.
        // so we log it but make it non-fatal.
        log("flush", err);
        cb(0);
      } else {
        fuseError(cb)(err);
      }
    }
  }

  fsync(path: string, dataSync: boolean, fd: number, cb: Callback) {
    log("fsync", { path, dataSync, fd });
    // Docs: "If dataSync is nonzero, only data, not metadata, needs to be flushed."
    this.flush(path, fd, cb);
  }

  fsyncdir(path: string, dataSync: boolean, fd: number, cb: Callback) {
    // TODO. Docs "Like fsync but for directories".
    log("fsyncdir - (not implemented)", { path, dataSync, fd });
    cb(0);
  }

  async readdir(path: string, cb) {
    if (this.isNotReady(cb)) return;
    log("readdir", path);
    if (this.dirCache?.has(path)) {
      cb(0, this.dirCache.get(path));
      return;
    }
    try {
      let handle, items;
      try {
        handle = await callback(this.sftp.opendir, path);
        log("readdir - opendir got a handle", handle._handle);
        items = await callback(this.sftp.readdir, handle);
      } finally {
        // do not block on this.
        this.sftp.close(handle, (err) => {
          log("WARNING: error closing dir", err);
        });
      }
      //log("readdir - items", items);
      // todo: cache attrs from items (?)
      if (typeof items == "boolean") {
        throw Error("readdir fail");
      }
      const filenames = items.map(({ filename }) => filename);
      if (this.attrCache != null) {
        for (const { filename, stats, longname } of items) {
          try {
            stats.blocks = parseInt(longname.split(" ")[0]);
          } catch (_) {}
          this.attrCache.set(join(path, filename), { attr: stats });
        }
      }
      this.dirCache?.set(path, filenames);
      cb(0, filenames);
    } catch (err) {
      log("readdir - error", err);
      fuseError(cb)(err);
    }
  }

  // TODO: truncate doesn't seem to be in sftp spec... but we can add anything
  // we want later for speed purposes, right?
  truncate(path: string, size: number, cb) {
    if (this.isNotReady(cb)) return;
    log("truncate", { path, size });
    this.clearCache(path);
    this.sftp.setstat(path, { size }, fuseError(cb));
  }

  ftruncate(path: string, fd: number, size: number, cb) {
    if (this.isNotReady(cb)) return;
    log("ftruncate", { path, fd, size });
    this.truncate(path, size, cb);
  }

  readlink(path, cb) {
    if (this.isNotReady(cb)) return;
    log("readlink", path);
    if (this.linkCache?.has(path)) {
      cb(0, this.linkCache.get(path));
      return;
    }
    this.sftp.readlink(path, (err, target) => {
      if (this.linkCache != null) {
        this.linkCache.set(path, target);
      }
      fuseError(cb)(err, target);
    });
  }

  // We purposely do NOT implement chown, since it traditionally doesn't
  // mean much for sshfs/fuse, and we don't want it to (everything gets mapped)
  // for our application to cocalc.
  chown(path: string, uid: number, gid: number, cb) {
    log("chown -- not implemented", { path, uid, gid });
    cb(0);
  }

  utimens(path, atime, mtime, cb) {
    log("utimens-- not implemented", { path, atime, mtime });
    cb(0);
  }

  chmod(path: string, mode: number, cb) {
    if (this.isNotReady(cb)) return;
    log("chmod", { path, mode });
    this.attrCache?.delete(path);
    this.sftp.setstat(path, { mode }, fuseError(cb));
  }

  // mknod(path, mode, dev, cb)

  //   setxattr(path, name, value, position, flags, cb) {
  //     log("setxattr", { path, name, value, position, flags });
  //     cb(0);
  //   }

  //   getxattr(path, name, position, cb) {
  //     log("getxattr", path, name, position);
  //     cb(0, null);
  //   }
  // listxattr(path, cb)
  // removexattr(path, name, cb)

  open(path: string, flags: string | number, cb) {
    if (this.isNotReady(cb)) return;
    log("open", { path, flags });
    if (typeof flags == "number") {
      flags = convertOpenFlags(flags);
    }
    this.clearCache(path);
    this.sftp.open(path, flags, {}, (err, handle) => {
      if (err) {
        fuseError(cb)(err);
        return;
      }
      const fd = handle.toFileDescriptor();
      log("open succeeded", { fd });
      cb(0, fd);
    });
  }

  // opendir(path, flags, cb)

  private _read(
    handle,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead?: number) => void,
  ) {
    this.sftp.read(
      handle,
      buffer,
      offset,
      length,
      position,
      (err, _buffer, bytesRead) => {
        callback(err, bytesRead);
      },
    );
  }

  async read(
    path: string,
    fd: number,
    buf: Buffer,
    len: number,
    pos: number,
    cb: Callback,
  ) {
    log("read", { path, fd, len, pos });
    if (this.isNotReady(cb)) return;
    const handle = this.sftp.fileDescriptorToHandle(fd);
    log("read - open got a handle", handle._handle);
    // We *must* read in chunks of size at most MAX_READ_BLOCK_LENGTH,
    // or the result will definitely be all corrupted (of course).
    let bytesRead = 0;
    let offset = 0;
    let position = pos;
    try {
      while (len > 0) {
        let length = Math.min(MAX_READ_BLOCK_LENGTH, len);
        const newBytesRead = await callback(
          this._read,
          handle,
          buf,
          offset,
          length,
          position,
        );
        if (newBytesRead == 0) {
          break;
        }
        bytesRead += newBytesRead;
        offset += newBytesRead;
        len -= newBytesRead;
        position += newBytesRead;
      }
      cb(bytesRead);
    } catch (err) {
      log("read -- error reading", err);
      fuseError(cb)(err);
    }
  }

  async write(
    path: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    cb: Callback,
  ) {
    //log("write", { path, fd, buffer: buffer.toString(), length, position });
    if (this.isNotReady(cb)) return;
    log("write", { path, fd, length, position });
    this.clearCache(path);
    if (this.data[fd] == null) {
      this.data[fd] = [
        { buffer: Buffer.from(buffer.slice(0, length)), position },
      ];
    } else {
      this.data[fd].push({
        buffer: Buffer.from(buffer.slice(0, length)),
        position,
      });
      if (this.data[fd].length > 50) {
        await this.flush(path, fd, (err) => {
          if (err) {
            fuseError(cb)(err);
          } else {
            cb(length);
          }
        });
        return;
      }
    }
    cb(length);
  }

  private async writeToDisk(
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
  ): Promise<number> {
    log("writeToDisk", { fd, length, position });
    const handle = this.sftp.fileDescriptorToHandle(fd);
    // We *must* write in chunks of size at most MAX_WRITE_BLOCK_LENGTH,
    // or the result will definitely be all corrupted (of course).
    length = Math.min(length, buffer.length);
    let bytesWritten = 0;
    let offset = 0;
    while (length > 0) {
      const n = Math.min(MAX_WRITE_BLOCK_LENGTH, length);
      await callback(this.sftp.write, handle, buffer, offset, n, position);
      length -= n;
      bytesWritten += n;
      offset += n;
      position += n;
    }
    return bytesWritten;
  }

  release(path: string, fd: number, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("release", { path, fd });
    const handle = this.sftp.fileDescriptorToHandle(fd);
    this.sftp.close(handle, fuseError(cb));
  }

  releasedir(path, fd, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("releasedir", { path, fd });
    const handle = this.sftp.fileDescriptorToHandle(fd);
    this.sftp.close(handle, fuseError(cb));
  }

  create(path: string, mode: number, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("create", { path, mode });
    this.open(path, "w", cb);
  }

  unlink(path: string, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("unlink", path);
    this.clearCache(path);
    this.sftp.unlink(path, fuseError(cb));
  }

  rename(src: string, dest: string, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("rename", { src, dest });
    this.clearCache(src);
    this.clearCache(dest);
    this.dirCache?.delete(dirname(src));
    this.dirCache?.delete(dirname(dest));
    // @ts-ignore
    this.sftp.rename(src, dest, RenameFlags.OVERWRITE, fuseError(cb));
  }

  link(src: string, dest: string, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("link", { src, dest });
    this.clearCache(src);
    this.clearCache(dest);
    this.dirCache?.delete(dirname(src));
    this.dirCache?.delete(dirname(dest));
    this.sftp.link(src, dest, fuseError(cb));
  }

  symlink(src: string, dest: string, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("symlink", { src, dest });
    this.clearCache(src);
    this.clearCache(dest);
    this.sftp.symlink(src, dest, fuseError(cb));
  }

  mkdir(path: string, mode: number, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("mkdir", { path, mode });
    this.clearCache(path);
    this.sftp.mkdir(path, { mode }, fuseError(cb));
  }

  rmdir(path: string, cb: Callback) {
    if (this.isNotReady(cb)) return;
    log("rmdir", { path });
    this.clearCache(path);
    this.sftp.rmdir(path, fuseError(cb));
  }

  private clearCache(path: string) {
    this.attrCache?.delete(path);
    if (this.dirCache != null) {
      this.dirCache?.delete(path);
      this.dirCache?.delete(dirname(path));
    }
  }
}

function getErrno(err: SftpError): number {
  if (err.description != null) {
    const e = Fuse[err.description];
    if (e != null) {
      return e;
    }
  }
  if (err.code != null) {
    const errno = Fuse[err.code];
    if (errno) {
      return errno;
    }
    if (err.errno != null) {
      return -Math.abs(err.errno);
    }
  }
  console.warn("err.code and err.errno not set -- ", err);
  return Fuse.ENOSYS;
}

function fuseError(cb) {
  return (err: SftpError, ...args) => {
    // console.log("response -- ", { err, args });
    if (err) {
      cb(getErrno(err));
    } else {
      cb(0, ...args);
    }
  };
}
