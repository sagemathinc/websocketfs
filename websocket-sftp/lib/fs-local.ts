import fs from "fs";
import { IFilesystem, IItem, IStats, RenameFlags } from "./fs-api";
import { FileUtil, Path } from "./fs-misc";
// note that this is in node.js v 18.15 and later
// as (fs/promises).statvfs (they are both wrapping
// the same uv_fs_statfs).
import { statvfs } from "@wwa/statvfs";
import type { StatFs } from "./fs-api";
import debug from "debug";

const log = debug("websocketfs:fs-local");

export class LocalFilesystem implements IFilesystem {
  private isWindows: boolean;

  constructor() {
    this.isWindows = process.platform === "win32";
  }

  private checkPath(path0: string, name: string): string {
    const localPath = Path.create(path0, this, name);
    let path = localPath.path;

    if (path[0] == "~") {
      const home = <string>(process.env.HOME || process.env.USERPROFILE || ".");
      if (path.length == 1) {
        return home;
      }
      if (path[1] === "/" || (path[1] === "\\" && this.isWindows)) {
        path = localPath.join(home, path.substr(2)).path;
      }
    }

    return path;
  }

  private checkCallback(callback: any): void {
    if (typeof callback !== "function")
      throw new Error("Callback must be a function");
  }

  open(
    path: string,
    flags: string | number,
    attrs: IStats | undefined,
    callback: (err: Error | null, handle: any) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    const mode = attrs?.mode;
    fs.open(path, flags, mode, (err, fd) => callback(err, fd));
    //LATER: pay attemtion to attrs other than mode (low priority - many SFTP servers ignore these as well)
  }

  fsync(handle: number, callback: (err: Error | null) => any): void {
    fs.fsync(handle, callback);
  }

  close(handle: any, callback: (err: Error | null) => any): void {
    this.checkCallback(callback);

    if (Array.isArray(handle)) {
      // @ts-ignore
      if (handle.closed) {
        return FileUtil.fail("Already closed", callback);
      }
      // @ts-ignore
      handle.closed = true;
      process.nextTick(() => callback(null));
      return;
    }

    if (isNaN(handle)) {
      return FileUtil.fail("Invalid handle", callback);
    }

    fs.close(handle, callback);
  }

  read(
    handle: any,
    buffer: Buffer | null,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, buffer: Buffer, bytesRead: number) => any,
  ): void {
    this.checkCallback(callback);

    let totalBytes = 0;

    let buf: Buffer;
    if (buffer == null) {
      buf = Buffer.alloc(length);
      offset = 0;
    } else {
      buf = buffer;
    }

    let offset2 = offset;

    const read = () => {
      fs.read(handle, buf, offset2, length, position, (err, bytesRead) => {
        if (err == null) {
          length -= bytesRead;
          totalBytes += bytesRead;

          if (length > 0 && bytesRead > 0) {
            offset2 += bytesRead;
            position += bytesRead;
            read();
            return;
          }
        }
        callback(err, buf.slice(offset, offset + totalBytes), totalBytes);
      });
    };

    read();
  }

  write(
    handle: any,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);

    const write = () => {
      fs.write(
        handle,
        buffer,
        offset,
        length,
        position,
        (err, bytesWritten) => {
          if (typeof err === "undefined" || err == null) {
            length -= bytesWritten;

            if (length > 0) {
              offset += bytesWritten;
              position += bytesWritten;
              write();
              return;
            }
          }

          callback(err);
        },
      );
    };

    write();
  }

  lstat(
    path: string,
    callback: (err: Error | null, attrs: IStats) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.lstat(path, callback);
  }

  fstat(
    handle: any,
    callback: (err: Error | null, attrs: IStats) => any,
  ): void {
    this.checkCallback(callback);

    fs.fstat(handle, callback);
  }

  private run(actions: Function[], callback: (err: Error | null) => any) {
    if (actions.length == 0) {
      process.nextTick(() => callback(null));
      return;
    }

    let action = actions.shift();

    const next = (err?: NodeJS.ErrnoException) => {
      if (typeof err !== "undefined" && err != null) {
        callback(err);
        return;
      }

      if (actions.length == 0) {
        callback(null);
        return;
      }

      action = actions.shift();
      action?.(next);
    };

    action?.(next);
  }

  setstat(
    path: string,
    attrs: IStats,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    const actions = new Array<Function>();

    if (!isNaN(attrs.uid ?? NaN) || !isNaN(attrs.gid ?? NaN))
      actions.push(function (next: Function) {
        fs.chown(path, attrs.uid ?? 0, attrs.gid ?? 0, (err) => next(err));
      });

    if (!isNaN(attrs.mode ?? NaN))
      actions.push(function (next: Function) {
        fs.chmod(path, attrs.mode ?? 0, (err) => next(err));
      });

    if (!isNaN(attrs.size ?? NaN))
      actions.push(function (next: Function) {
        fs.truncate(path, attrs.size ?? 0, (err) => next(err));
      });

    if (attrs.atime != null || attrs.mtime != null) {
      // note that for utimes in node both atime and mtime must be given.
      const atime = attrs.atime;
      const mtime = attrs.mtime;
      actions.push(function (next: Function) {
        // it handles null input fine
        fs.utimes(path, atime!, mtime!, (err) => next(err));
      });
    }

    this.run(actions, callback);
  }

  fsetstat(
    handle: any,
    attrs: IStats,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);

    const actions = new Array<Function>();

    if (!isNaN(attrs.uid ?? NaN) || !isNaN(attrs.gid ?? NaN))
      actions.push(function (next: Function) {
        fs.fchown(handle, attrs.uid ?? 0, attrs.gid ?? 0, (err) => next(err));
      });

    if (!isNaN(attrs.mode ?? NaN))
      actions.push(function (next: Function) {
        fs.fchmod(handle, attrs.mode ?? 0, (err) => next(err));
      });

    if (!isNaN(attrs.size ?? NaN))
      actions.push(function (next: Function) {
        fs.ftruncate(handle, attrs.size ?? 0, (err) => next(err));
      });

    if (attrs.atime != null || attrs.mtime != null) {
      const atime = attrs.atime;
      const mtime = attrs.mtime;
      actions.push(function (next: Function) {
        // it handles null input fine
        fs.futimes(handle, atime!, mtime!, (err) => next(err));
      });
    }

    this.run(actions, callback);
  }

  opendir(
    path: string,
    callback: (err: Error | null, handle: any) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.readdir(path, (err, files: any) => {
      if (files) {
        files.splice(0, 0, ".", "..");
      }

      if (typeof err !== "undefined" && err != null) {
        files = null;
      } else if (Array.isArray(files)) {
        files["path"] = new Path(path, this).normalize();
        err = null;
      } else {
        return FileUtil.fail("Unable to read directory", callback);
      }

      callback(err, files);
    });
  }

  readdir(
    handle: any,
    callback: (err: Error | null, items: IItem[] | false) => any,
  ): void {
    this.checkCallback(callback);
    if (
      !Array.isArray(handle) ||
      // @ts-ignore
      handle.closed ||
      // @ts-ignore
      typeof handle.path !== "object"
    ) {
      return FileUtil.fail("Invalid handle", callback);
    }
    const items: IItem[] = [];

    // @ts-ignore
    const path = <Path>handle.path;
    const paths = (<string[]>handle).splice(0, 64);

    if (paths.length == 0) {
      process.nextTick(() => callback(null, false));
      return;
    }

    function next(): void {
      const name = paths.shift();

      if (!name) {
        callback(null, items.length > 0 ? items : false);
        return;
      }

      const itemPath = path.join(name).path;

      fs.lstat(itemPath, (err, stats) => {
        if (typeof err !== "undefined" && err != null) {
          log("readdir -- Failed to compute lstat of ", itemPath, err);
        } else {
          //
          items.push({
            filename: name ?? "", // name will be defined because of check above
            longname: FileUtil.toString(name ?? "", stats),
            stats,
          });
        }
        next();
      });
    }

    next();
  }

  unlink(path: string, callback: (err: Error | null) => any): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.unlink(path, callback);
  }

  mkdir(
    path: string,
    attrs: IStats | undefined,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    const mode = attrs && typeof attrs === "object" ? attrs.mode : undefined;
    fs.mkdir(path, mode, callback);
    //LATER: pay attemtion to attrs other than mode (low priority - many SFTP servers ignore these as well)
  }

  rmdir(path: string, callback: (err: Error | null) => any): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.rmdir(path, callback);
  }

  realpath(
    path: string,
    callback: (err: Error | null, resolvedPath?: string) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.realpath(path, callback);
  }

  stat(
    path: string,
    callback: (err: Error | null, attrs?: IStats) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.stat(path, callback);
  }

  async statvfs(
    path: string,
    callback: (err: Error | null, stats?: StatFs) => void,
  ): Promise<void> {
    path = this.checkPath(path, "path");
    try {
      callback(null, await statvfs(path));
    } catch (err) {
      callback(err);
    }
  }

  rename(
    oldPath: string,
    newPath: string,
    flags: RenameFlags,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);
    oldPath = this.checkPath(oldPath, "oldPath");
    newPath = this.checkPath(newPath, "newPath");

    if (flags === RenameFlags.OVERWRITE) {
      // posix-style rename (with overwrite)
      fs.rename(oldPath, newPath, callback);
    } else if (flags === 0) {
      // Windows-style rename (fail if destination exists)
      fs.link(oldPath, newPath, (err) => {
        if (err) return callback(err);

        fs.unlink(oldPath, (err) => {
          callback(err);
        });
      });
    } else {
      FileUtil.fail("ENOSYS", callback);
    }
  }

  readlink(
    path: string,
    callback: (err: Error | null, linkString: string) => any,
  ): void {
    this.checkCallback(callback);
    path = this.checkPath(path, "path");

    fs.readlink(path, callback);
  }

  symlink(
    oldPath: string,
    newPath: string,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);
    oldPath = this.checkPath(oldPath, "oldPath");
    newPath = this.checkPath(newPath, "newPath");
    fs.symlink(newPath, oldPath, "file", callback);
  }

  link(
    oldPath: string,
    newPath: string,
    callback: (err: Error | null) => any,
  ): void {
    this.checkCallback(callback);
    oldPath = this.checkPath(oldPath, "oldPath");
    newPath = this.checkPath(newPath, "newPath");

    fs.link(oldPath, newPath, callback);
  }
}
