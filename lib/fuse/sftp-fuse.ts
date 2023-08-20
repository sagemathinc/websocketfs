/*

Some relevant docs:
- https://libfuse.github.io/doxygen/structfuse__operations.html
- https://github.com/direktspeed/node-fuse-bindings
- https://filezilla-project.org/specs/draft-ietf-secsh-filexfer-02.txt
//
*/
import { Client as SftpClient } from "../sftp/sftp";
import { callback } from "awaiting";
import { bindMethods } from "./util";
import { convertOpenFlags } from "./flags";
import Fuse from "@cocalc/fuse-native";
import type { SftpError } from "../sftp/util";

import debug from "debug";

const log = debug("websocketfs:fuse:sftp");

type Callback = Function;

export default class SftpFuse {
  private remote: string;
  private sftp: SftpClient;

  constructor(remote: string) {
    this.remote = remote;
    this.sftp = new SftpClient();
    bindMethods(this.sftp);
    bindMethods(this);
  }

  async connect() {
    log("connecting to ", this.remote);
    await callback(this.sftp.connect, this.remote, {});
  }

  end() {
    log("ending connectiong to", this.remote);
    this.sftp.end();
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

  //   statfs(path: string, cb) {
  //     // this gets called when you do "df" on the mountpoint.
  //     log("statfs: TODO", path);
  //     cb(0, {});
  //   }

  getattr(path: string, cb) {
    log("getattr", path);
    this.sftp.lstat(path, fuseError(cb));
  }

  fgetattr(path: string, _fd: number, cb) {
    log("fgetattr", path);
    this.getattr(path, fuseError(cb));
  }

  //   flush(path: string, _fd: number, cb) {
  //     log("flush", path);
  //     // TODO: this will impact caching...?
  //     cb(0);
  //   }

  //   fsync(path: string, _fd: number, _datasync, cb) {
  //     log("fsync", path);
  //     cb(0);
  //   }

  //   fsyncdir(path: string, _fd: number, _datasync, cb) {
  //     log("fsyncdir", path);
  //     cb(0);
  //   }

  async readdir(path: string, cb) {
    log("readdir", path);
    try {
      const handle = await callback(this.sftp.opendir, path);
      log("readdir - opendir got a handle", handle._handle);
      const items = await callback(this.sftp.readdir, handle);
      log("readdir - items", items);
      // todo: cache attrs from items (?)
      if (typeof items == "boolean") {
        throw Error("readdir fail");
      }
      cb(
        0,
        items.map(({ filename }) => filename),
      );
      return items;
    } catch (err) {
      log("readdir - error", err);
      fuseError(cb)(err);
    }
  }

  // TODO: truncate doesn't seem to be in sftp spec... but we can add anything
  // we want later for speed purposes, right?
  truncate(path: string, size: number, cb) {
    log("truncate", { path, size });
    this.sftp.setstat(path, { size }, fuseError(cb));
  }

  ftruncate(path: string, fd: number, size: number, cb) {
    log("ftruncate", { path, fd, size });
    this.truncate(path, size, cb);
  }

  readlink(path, cb) {
    log("readlink", path);
    this.sftp.readlink(path, fuseError(cb));
  }

  // We purposely do NOT implement chown, since it traditionally doesn't
  // mean much for sshfs/fuse, and we don't want it to (everything gets mapped)
  // for our application to cocalc.
  chown(path: string, uid: number, gid: number, cb) {
    log("chown", { path, uid, gid });
    cb(0);
  }

  utimens(path, atime, mtime, cb) {
    log("utimens", { path, atime, mtime });
    cb(0);
  }

  chmod(path: string, mode: number, cb) {
    log("chmod", { path, mode });
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
    log("open", { path, flags });
    if (typeof flags == "number") {
      flags = convertOpenFlags(flags);
    }
    this.sftp.open(path, flags, {}, (err, handle) => {
      if (err) {
        fuseError(cb)(err);
        return;
      }
      log("open succeeded", handle.toFileDescriptor());
      cb(0, handle.toFileDescriptor());
    });
  }

  // opendir(path, flags, cb)

  async read(
    path: string,
    fd: number,
    buf: Buffer,
    len: number,
    pos: number,
    cb: Callback,
  ) {
    log("read", { path, fd, len, pos });
    const handle = this.sftp.fileDescriptorToHandle(fd);
    log("read - open got a handle", handle._handle);
    this.sftp.read(handle, buf, 0, len, pos, (err, _buffer, bytesRead) => {
      if (err) {
        log("read -- error reading", err);
        fuseError(cb)(err);
      } else {
        cb(bytesRead);
      }
    });
  }

  write(
    path: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    cb: Callback,
  ) {
    log("write", { path, fd, buffer: buffer.toString(), length, position });
    const handle = this.sftp.fileDescriptorToHandle(fd);
    this.sftp.write(handle, buffer, 0, length, position, (err) => {
      if (err) {
        log("write -- error writing", err);
        fuseError(cb)(err);
      } else {
        cb(length);
      }
    });
  }

  release(path: string, fd: number, cb: Callback) {
    log("release", { path, fd });
    const handle = this.sftp.fileDescriptorToHandle(fd);
    this.sftp.close(handle, fuseError(cb));
  }

  // releasedir(path, fd, cb)

  //   create(path: string, mode: number, cb: Callback) {
  //     log("create", { path, mode });
  //     cb(0);
  //   }

  async unlink(path: string, cb: Callback) {
    log("unlink", path);
    this.sftp.unlink(path, fuseError(cb));
  }
}

function fuseError(cb) {
  return (err: SftpError, ...args) => {
    if (err) {
      if (err.code != null) {
        cb(Fuse[err.code] ?? err);
      } else {
        console.warn("err.code not set!", err);
        cb(Fuse.ENOSYS);
      }
    } else {
      cb(0, ...args);
    }
  };
}
