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

  access(path: string, mode: number, cb) {
    log("access", path, mode);
    // TODO
    cb(0);
  }

  statfs(path: string, cb) {
    // this gets called when you do "df" on the mountpoint.
    log("statfs: TODO", path);
    cb(0, {});
  }

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
  // truncate(path:string, size:number, cb) {  }
  // ftruncate(path:string, fd:number, size:number, cb) {  }

  readlink(path, cb) {
    log("readlink", path);
    this.sftp.readlink(path, fuseError(cb));
  }

  // We purposely do NOT implement chown, since it traditionally doesn't
  // mean much for sshfs/fuse, and we don't want it to (everything gets mapped)
  // for our application to cocalc.
  //   chown(path:string, uid:number, gid:number, cb)

  chmod(path: string, mode: number, cb) {
    log("chmod", { path, mode });
    this.sftp.setstat(path, { mode }, fuseError(cb));
  }

  async read(
    path: string,
    _fd: number,
    buf: Buffer,
    len: number,
    pos: number,
    cb: Callback,
  ) {
    log("read", { path, len, pos });
    let handle: any = undefined;
    try {
      handle = await callback(this.sftp.open, path, "r", {});
      log("read - open got a handle", handle._handle);
      this.sftp.read(handle, buf, 0, len, pos, (err, _buffer, bytesRead) => {
        if (err) {
          log("read -- error reading", err);
          fuseError(cb)(err);
        } else {
          cb(bytesRead);
        }
      });
    } catch (err) {
      log("read -- error opening file", err);
      fuseError(cb)(err);
    } finally {
      if (handle != null) {
        try {
          await callback(this.sftp.close, handle);
        } catch (err) {
          log("read -- error closing (ignoring)", err);
        }
      }
    }
  }

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
        console.warn(err);
        cb(Fuse.ENOSYS);
      }
    } else {
      cb(0, ...args);
    }
  };
}
