import { SftpPacket, SftpPacketWriter, SftpPacketReader } from "./sftp-packet";
import {
  SftpAttributes,
  SftpStatus,
  SftpFlags,
  SftpExtensions,
} from "./sftp-misc";
import { SafeFilesystem } from "./fs-safe";
import { IStats, IItem, RenameFlags, StatFs } from "./fs-api";
import { FileUtil } from "./fs-misc";
import { ILogWriter, LogHelper, LogLevel } from "./util";
import { IChannel } from "./channel";
import { SftpPacketType, SftpStatusCode } from "./sftp-enums";
import debug from "debug";
import { SftpVfsStats } from "./sftp-misc";

const log = debug("websocketfs:sftp-server");

class SftpResponse extends SftpPacketWriter {
  constructor() {
    super(34000);
  }
}

class SftpRequest extends SftpPacketReader {
  constructor(buffer: Buffer) {
    super(buffer);
  }

  // Read the number 4 followed by a 4-byte handle.
  // Basically, we are assuming that a handle is always
  // exactly 4 bytes, which is fine since we implement
  // the client and the server.
  readHandle(): number | null {
    // first read that the handle will be 4 bytes long.
    if (this.readInt32() != 4) {
      return null;
    }
    // Now read the actual handle.
    return this.readInt32();
  }
}

class SftpException {
  message: string;
  code: SftpStatusCode;
  errno: number;

  constructor(err: NodeJS.ErrnoException) {
    let message: string;
    let code = SftpStatusCode.FAILURE;
    const errno = err.errno ?? 0;
    // loosely based on the list from https://github.com/rvagg/node-errno/blob/master/errno.js
    // with updates besed on http://www-numi.fnal.gov/offline_software/srt_public_context/WebDocs/Errors/unix_system_errors.html

    // We put the error constant in the description,
    // so it can be used by FUSE on the native OS, since the sftp spec
    // only has a small number of error status codes, and they get mapped
    // back to a small subset of what the OS provides. But we're mainly
    // planning to use this on linux/posix, so can provide higher fidelity.
    // This is VERY important, e.g., without doing this when you do
    //   fs.rm('...', {recursive:true})
    // in node.js, it fails since the error code is wrong!
    // This is slightly slower and involves more bandwidth, but is worth it.

    switch (errno) {
      default:
        if (err["isPublic"] === true) {
          message = err.message;
        } else {
          message = "Unknown error (" + errno + ")";
        }
        break;
      case 1: // EOF
        message = "EOF"; // End of file
        code = SftpStatusCode.EOF;
        break;
      case 3: // EACCES
        message = "EACCES"; // Permission denied
        code = SftpStatusCode.PERMISSION_DENIED;
        break;
      case 4: // EAGAIN
        message = "EAGAIN"; // Try again";
        break;
      case 9: // EBADF
        message = "EBADF"; // Bad file number";
        break;
      case 10: // EBUSY
        message = "EBUSY"; // Device or resource busy";
        break;
      case 18: // EINVAL
        message = "EINVAL"; // Invalid argument";
        break;
      case 20: // EMFILE
        message = "EMFILE"; // Too many open files";
        break;
      case 24: // ENFILE
        message = "ENFILE"; // File table overflow";
        break;
      case 25: // ENOBUFS
        message = "ENOBUFS"; // No buffer space available";
        break;
      case 26: // ENOMEM
        message = "ENOMEM"; // Out of memory";
        break;
      case 27: // ENOTDIR
        message = "ENOTDIR"; // Not a directory";
        break;
      case 28: // EISDIR
        message = "EISDIR"; // Is a directory";
        break;
      case -2: // ENOENT on Linux with Node >=0x12 (or node-webkit - see http://stackoverflow.com/questions/23158277/why-does-the-errno-in-node-webkit-differ-from-node-js)
      case -4058: // ENOENT on Windows with Node >=0.12
      case 34: // ENOENT
        message = "ENOENT"; // No such file or directory";
        code = SftpStatusCode.NO_SUCH_FILE;
        break;
      case 35: // ENOSYS
        message = "ENOSYS"; // Operation not supported";
        code = SftpStatusCode.OP_UNSUPPORTED;
        break;
      case -17: // Node >=0.12 on Linux
      case -4075: // Node >=0.12 on Windows
      case 47: // EEXIST
        message = "EEXIST"; // File exists";
        break;
      case 49: // ENAMETOOLONG
        message = "ENAMETOOLONG"; // File name too long";
        break;
      case 50: // EPERM
      case -4048: // EPERM on Windows with Node >=0.12
        message = "EPERM"; // Operation not permitted";
        break;
      case 51: // ELOOP
        message = "ELOOP"; // Too many symbolic links encountered";
        break;
      case 52: // EXDEV
        message = "EXDEV"; // Cross-device link";
        break;
      case 53: // ENOTEMPTY
      case -39:
        message = "ENOTEMPTY"; // ENOTEMPTY: Directory not empty";
        break;
      case 54: // ENOSPC
        message = "ENOSPC"; // No space left on device";
        break;
      case 55: // EIO
        message = "EIO"; // I/O error";
        break;
      case 56: // EROFS
        message = "EROFS"; // Read-only file system";
        break;
      case 57: // ENODEV
        message = "ENODEV"; // No such device";
        code = SftpStatusCode.NO_SUCH_FILE;
        break;
      case -29: // Node >=0.12 on Linux
      case 58: // ESPIPE
        message = "ESPIPE"; // Invalid seek";
        break;
      case 59: // ECANCELED
        message = "ECANCELED"; // Operation canceled";
        break;
    }

    this.message = message;
    this.code = code;
    this.errno = errno;
  }
}

export class SftpServerSession {
  private _id: number;
  private _fs: SafeFilesystem;
  private _channel: IChannel;
  private _log: ILogWriter;
  private _items: IItem[][];
  private _debug: boolean;
  private _trace: boolean;

  private static _nextSessionId = 1;

  constructor(
    channel: IChannel,
    fs: SafeFilesystem,
    emitter: NodeJS.EventEmitter,
    oldlog: ILogWriter,
    meta: any,
  ) {
    this._id = SftpServerSession._nextSessionId++;
    this._fs = fs;
    this._channel = channel;
    this._log = oldlog;
    this._items = [];

    // determine the log level now to speed up logging later
    const level = LogHelper.getLevel(oldlog);
    this._debug = level <= LogLevel.DEBUG;
    this._trace = level <= LogLevel.TRACE;

    log("Session started", this._id, meta);

    channel.on("message", (packet) => {
      // log("Received message", packet);
      try {
        this._process(packet);
      } catch (err) {
        log("Error while accepting request", this._id, err);
        emitter.emit("error", err, this);
        this.end();
      }
    });

    channel.on("close", (err) => {
      if (!err) {
        log("Session closed by the client", this._id);
      } else if (err.code === "ECONNABORTED" || err.code === "X_GOINGAWAY") {
        log("Session aborted by the client", this._id);
        err = null;
      } else {
        log("Session failed", this._id, err);
      }

      this.end();
      if (!emitter.emit("closedSession", this, err)) {
        if (err) {
          // prevent channel failures from crashing the server when no error handler is registered
          const listeners = emitter.listeners("error");
          if (listeners && listeners.length > 0) {
            emitter.emit("error", err, this);
          }
        }
      }
    });
  }

  private send(response: SftpResponse): void {
    // send packet
    const packet = response.finish();

    if (this._debug) {
      // logging
      const meta: { [key: string]: any } = {};
      meta["session"] = this._id;
      if (response.type != SftpPacketType.VERSION) {
        meta["req"] = response.id;
      }
      meta["type"] = SftpPacket.toString(response.type ?? "");
      meta["length"] = packet.length;
      if (this._trace) meta["raw"] = packet;

      if (response.type == SftpPacketType.VERSION) {
        this._log.debug(meta, "[%d] - Sending version response", this._id);
      } else {
        this._log.debug(
          meta,
          "[%d] #%d - Sending response",
          this._id,
          response.id,
        );
      }
    }

    this._channel.send(packet);
  }

  private sendStatus(
    response: SftpResponse,
    code: number,
    message: string,
  ): void {
    SftpStatus.write(response, code, message);
    this.send(response);
  }

  private sendError(
    response: SftpResponse,
    err: Error,
    isFatal: boolean,
  ): void {
    let message: string;
    let code: SftpStatusCode;

    if (!isFatal) {
      const error = new SftpException(err);
      code = error.code;
      message = error.message;
    } else {
      code = SftpStatusCode.FAILURE;
      message = "Internal server error";
    }

    if (this._debug || isFatal) {
      const meta = {
        reason: message,
        nativeCode: code,
        err,
      };

      if (!isFatal) {
        this._log.debug(
          meta,
          "[%d] #%d - Request failed",
          this._id,
          response.id,
        );
      } else {
        this._log.error(
          meta,
          "[%d] #%d - Error while processing request",
          this._id,
          response.id,
        );
      }
    }

    SftpStatus.write(response, code, message);
    this.send(response);
  }

  private sendIfError(
    response: SftpResponse,
    err: NodeJS.ErrnoException | null,
  ): boolean {
    if (err == null || typeof err === "undefined") {
      return false;
    }

    this.sendError(response, err, false);
    return true;
  }

  private sendSuccess(
    response: SftpResponse,
    err: NodeJS.ErrnoException | null,
  ): void {
    if (this.sendIfError(response, err)) {
      return;
    }

    SftpStatus.writeSuccess(response);
    this.send(response);
  }

  private sendAttribs(
    response: SftpResponse,
    err: NodeJS.ErrnoException | null,
    stats?: IStats,
  ): void {
    if (this.sendIfError(response, err)) {
      return;
    }
    if (stats == null) {
      throw Error("bug"); // for typescript
    }

    response.type = SftpPacketType.ATTRS;
    response.start();

    const attr = new SftpAttributes();
    attr.from({ ...stats, metadata: { blocks: stats.blocks! } });
    attr.write(response);
    this.send(response);
  }

  private sendVfsStats(
    response: SftpResponse,
    err: NodeJS.ErrnoException | null,
    stats?: StatFs,
  ): void {
    if (this.sendIfError(response, err)) {
      return;
    }
    if (stats == null) {
      throw Error("bug"); // for typescript
    }

    response.type = SftpPacketType.VFSSTATS;
    response.start();

    const stats0 = new SftpVfsStats();
    stats0.from(stats);
    stats0.write(response);
    this.send(response);
  }

  private sendHandle(response: SftpResponse, handle: number): void {
    response.type = SftpPacketType.HANDLE;
    response.start();

    response.writeInt32(4);
    response.writeInt32(handle);
    this.send(response);
  }

  private sendPath(
    response: SftpResponse,
    err: NodeJS.ErrnoException | null,
    path?: string,
  ): void {
    if (this.sendIfError(response, err)) {
      return;
    }
    if (path == null) {
      throw Error("path must not be null except when there is an error");
    }

    response.type = SftpPacketType.NAME;
    response.start();

    response.writeInt32(1);
    response.writeString(path);
    response.writeString("");
    response.writeInt32(0);
    this.send(response);
  }

  private writeItem(response: SftpPacketWriter, item: IItem): void {
    const attr = new SftpAttributes();
    attr.from(item.stats);

    const filename = item.filename;
    const longname = item.longname || FileUtil.toString(filename, attr);

    response.writeString(filename);
    response.writeString(longname);
    attr.write(response);
  }

  end(): void {
    this._channel.close();

    if (typeof this._fs === "undefined") return;

    // close all handles
    this._fs.end();
    // @ts-ignore
    delete this._fs;
  }

  _process(data: Buffer): void {
    const request = new SftpRequest(data);

    if (this._debug) {
      const meta = {};
      meta["session"] = this._id;
      if (request.type != SftpPacketType.INIT) meta["req"] = request.id;
      meta["type"] = SftpPacket.toString(request.type ?? "");
      meta["length"] = request.length;
      if (this._trace) meta["raw"] = request.buffer;

      if (request.type == SftpPacketType.INIT) {
        this._log.debug(
          meta,
          "[%d] - Received initialization request",
          this._id,
        );
      } else {
        this._log.debug(
          meta,
          "[%d] #%d - Received request",
          this._id,
          request.id,
        );
      }
    }

    const response = new SftpResponse();

    if (request.type == SftpPacketType.INIT) {
      response.type = SftpPacketType.VERSION;
      response.start();

      response.writeInt32(3);

      SftpExtensions.write(response, SftpExtensions.HARDLINK, "1");
      SftpExtensions.write(response, SftpExtensions.POSIX_RENAME, "1");
      SftpExtensions.write(response, SftpExtensions.STATVFS, "1");

      this.send(response);
      return;
    }

    response.id = request.id;
    this.processRequest(request, response);
  }

  private processRequest(request: SftpRequest, response: SftpResponse) {
    const fs = this._fs;
    if (fs == null) {
      // already disposed
      return;
    }
    try {
      switch (request.type) {
        case SftpPacketType.OPEN: {
          const path = request.readString();
          const pflags = request.readInt32();
          const attrs = new SftpAttributes(request);

          const modes = SftpFlags.fromNumber(pflags);
          if (modes.length == 0) {
            this.sendStatus(
              response,
              SftpStatusCode.FAILURE,
              "Unsupported flags",
            );
            return;
          }

          const openFile = () => {
            const mode = modes.shift();
            fs.open(path, mode ?? "", attrs, (err, handle) => {
              if (this.sendIfError(response, err)) {
                return;
              }
              if (handle == null) {
                throw Error("BUG: handle must be non-null");
              }

              if (modes.length == 0) {
                this.sendHandle(response, handle);
                return;
              }

              fs.close(handle, (err) => {
                if (this.sendIfError(response, err)) return;
                openFile();
              });
            });
          };

          openFile();
          return;
        }

        case SftpPacketType.CLOSE: {
          const handle = request.readHandle();
          if (handle == null) {
            throw Error("handle must not be null");
          }

          if (this._items[handle]) {
            delete this._items[handle];
          }

          fs.close(handle, (err) => this.sendSuccess(response, err));
          return;
        }

        case SftpPacketType.READ: {
          const handle = request.readHandle();
          if (handle == null) {
            throw Error("handle must not be null");
          }
          const position = request.readInt64();
          let count = request.readInt32();
          if (count > 0x8000) {
            count = 0x8000;
          }

          response.type = SftpPacketType.DATA;
          response.start();

          const offset = response.position + 4;
          response.check(4 + count);

          fs.read(
            handle,
            response.buffer,
            offset,
            count,
            position,
            (err, _b, bytesRead) => {
              if (this.sendIfError(response, err)) return;

              if (bytesRead == 0) {
                this.sendStatus(response, SftpStatusCode.EOF, "EOF");
                return;
              }

              response.writeUInt32(bytesRead);
              response.skip(bytesRead);
              this.send(response);
            },
          );
          return;
        }

        case SftpPacketType.WRITE: {
          const handle = request.readHandle();
          if (handle == null) {
            throw Error("handle must not be null");
          }
          const position = request.readUInt64();
          const count = request.readUInt32();
          const offset = request.position;
          request.skip(count);

          fs.write(handle, request.buffer, offset, count, position, (err) =>
            this.sendSuccess(response, err),
          );
          return;
        }

        case SftpPacketType.LSTAT: {
          const path = request.readString();

          fs.lstat(path, (err, stats) =>
            this.sendAttribs(response, err, stats),
          );
          return;
        }

        case SftpPacketType.FSTAT: {
          const handle = request.readHandle();
          if (handle == null) {
            throw Error("handle must not be null");
          }
          fs.fstat(handle, (err, stats) =>
            this.sendAttribs(response, err, stats),
          );
          return;
        }

        case SftpPacketType.STATVFS: {
          const path = request.readString();
          fs.statvfs(path, (err, stats) =>
            this.sendVfsStats(response, err, stats),
          );
          return;
        }

        case SftpPacketType.SETSTAT: {
          const path = request.readString();
          const attrs = new SftpAttributes(request);

          fs.setstat(path, attrs, (err) => this.sendSuccess(response, err));
          return;
        }

        case SftpPacketType.FSETSTAT: {
          const handle = request.readHandle();
          if (handle == null) {
            throw Error("handle must not be null");
          }
          const attrs = new SftpAttributes(request);

          fs.fsetstat(handle, attrs, (err) => this.sendSuccess(response, err));
          return;
        }

        case SftpPacketType.OPENDIR: {
          const path = request.readString();

          fs.opendir(path, (err, handle) => {
            if (this.sendIfError(response, err)) {
              return;
            }
            if (handle == null) {
              throw Error("handle must not be null");
            }
            this.sendHandle(response, handle);
          });
          return;
        }

        case SftpPacketType.READDIR: {
          const handle = request.readHandle();

          response.type = SftpPacketType.NAME;
          response.start();

          let count = 0;
          const offset = response.position;
          response.writeInt32(0);

          const done = () => {
            if (count == 0) {
              this.sendStatus(response, SftpStatusCode.EOF, "EOF");
            } else {
              response.buffer.writeInt32BE(count, offset);
              this.send(response);
            }
          };

          const next = (items: IItem[] | false) => {
            if (items === false) {
              done();
              return;
            }

            const list: IItem[] = items;

            while (list.length > 0) {
              const item = list.shift();
              if (item == null) {
                throw Error("bug");
              }
              this.writeItem(response, item);
              count++;

              if (response.position > 0x7000) {
                if (handle == null) {
                  throw Error("handle must not be null");
                }
                this._items[handle] = list;
                done();
                return;
              }
            }

            readdir();
          };

          const readdir = () => {
            if (handle == null) {
              throw Error("handle must not be null");
            }
            fs.readdir(handle, (err, items) => {
              if (this.sendIfError(response, err)) {
                return;
              }
              next(items);
            });
          };

          if (handle == null) {
            throw Error("handle must not be null");
          }
          const previous = this._items[handle];
          if (previous && previous.length > 0) {
            this._items[handle] = [];
            next(previous);
            return;
          }

          readdir();
          return;
        }

        case SftpPacketType.REMOVE: {
          const path = request.readString();

          fs.unlink(path, (err) => this.sendSuccess(response, err));
          return;
        }

        case SftpPacketType.MKDIR: {
          const path = request.readString();
          const attrs = new SftpAttributes(request);

          fs.mkdir(path, attrs, (err) => this.sendSuccess(response, err));
          return;
        }

        case SftpPacketType.RMDIR: {
          const path = request.readString();

          fs.rmdir(path, (err) => {
            this.sendSuccess(response, err);
          });
          return;
        }
        case SftpPacketType.REALPATH: {
          const path = request.readString();

          fs.realpath(path, (err, resolvedPath) =>
            this.sendPath(response, err, resolvedPath),
          );
          return;
        }

        case SftpPacketType.STAT: {
          const path = request.readString();

          fs.stat(path, (err, stats) => this.sendAttribs(response, err, stats));
          return;
        }

        case SftpPacketType.RENAME: {
          const oldPath = request.readString();
          const newPath = request.readString();

          fs.rename(oldPath, newPath, 0, (err) => {
            this.sendSuccess(response, err);
          });
          return;
        }

        case SftpPacketType.READLINK: {
          const path = request.readString();

          fs.readlink(path, (err, linkString) => {
            this.sendPath(response, err, linkString);
          });
          return;
        }

        case SftpPacketType.SYMLINK: {
          const linkpath = request.readString();
          const targetpath = request.readString();

          fs.symlink(targetpath, linkpath, (err) =>
            this.sendSuccess(response, err),
          );
          return;
        }

        case SftpExtensions.HARDLINK: {
          const oldpath = request.readString();
          const newpath = request.readString();

          fs.link(oldpath, newpath, (err) => this.sendSuccess(response, err));
          return;
        }

        case SftpExtensions.POSIX_RENAME: {
          const oldpath = request.readString();
          const newpath = request.readString();

          fs.rename(oldpath, newpath, RenameFlags.OVERWRITE, (err) =>
            this.sendSuccess(response, err),
          );
          return;
        }

        case SftpExtensions.COPY_DATA: {
          const fromHandle = request.readHandle();
          if (fromHandle == null) {
            throw Error("fromHandle must not be null");
          }
          const fromPosition = request.readInt64();
          const length = request.readInt64();
          const toHandle = request.readHandle();
          if (toHandle == null) {
            throw Error("toHandle must not be null");
          }
          const toPosition = request.readInt64();

          fs.fcopy(
            fromHandle,
            fromPosition,
            length,
            toHandle,
            toPosition,
            (err) => this.sendSuccess(response, err),
          );
          return;
        }

        case SftpExtensions.CHECK_FILE_HANDLE: {
          const handle = request.readHandle();
          if (handle == null) {
            throw Error("handle must not be null");
          }
          const alg = request.readString();
          const position = request.readInt64();
          const length = request.readInt64();
          const blockSize = request.readInt32();

          fs.fhash(
            handle,
            alg,
            position,
            length,
            blockSize,
            (err, hashes, alg) => {
              if (this.sendIfError(response, err)) return;

              response.type = SftpPacketType.EXTENDED_REPLY;
              response.start();
              response.resize(hashes.length + 1024);

              response.writeString(alg);
              response.writeData(hashes);
              this.send(response);
            },
          );
          return;
        }

        default: {
          this.sendStatus(
            response,
            SftpStatusCode.OP_UNSUPPORTED,
            "Not supported",
          );
        }
      }
    } catch (err) {
      this.sendError(response, err, true);
    }
  }
}
