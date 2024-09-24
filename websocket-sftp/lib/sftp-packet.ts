import { SftpPacketType } from "./sftp-enums";
import { encodeUTF8 } from "./charsets";

export class SftpPacket {
  type: SftpPacketType | string | null = null;
  id: number | null = null;

  buffer: Buffer;
  position: number;
  length: number;

  constructor() {}

  check(count: number): void {
    const remaining = this.length - this.position;
    if (count > remaining) throw new Error("Unexpected end of packet");
  }

  skip(count: number): void {
    this.check(count);
    this.position += count;
  }

  resize(size: number): void {
    const buffer = Buffer.alloc(size);
    this.buffer.copy(buffer);
    this.buffer = buffer;
    this.length = buffer.length;
  }

  static isBuffer(obj: any): boolean {
    return Buffer.isBuffer(obj);
  }

  static toString(packetType: SftpPacketType | string): string {
    if (typeof packetType === "string") return packetType;
    switch (packetType) {
      case SftpPacketType.INIT:
        return "INIT";
      case SftpPacketType.VERSION:
        return "VERSION";
      case SftpPacketType.OPEN:
        return "OPEN";
      case SftpPacketType.CLOSE:
        return "CLOSE";
      case SftpPacketType.READ:
        return "READ";
      case SftpPacketType.WRITE:
        return "WRITE";
      case SftpPacketType.LSTAT:
        return "LSTAT";
      case SftpPacketType.FSTAT:
        return "FSTAT";
      case SftpPacketType.SETSTAT:
        return "SETSTAT";
      case SftpPacketType.FSETSTAT:
        return "FSETSTAT";
      case SftpPacketType.OPENDIR:
        return "OPENDIR";
      case SftpPacketType.READDIR:
        return "READDIR";
      case SftpPacketType.REMOVE:
        return "REMOVE";
      case SftpPacketType.MKDIR:
        return "MKDIR";
      case SftpPacketType.RMDIR:
        return "RMDIR";
      case SftpPacketType.REALPATH:
        return "REALPATH";
      case SftpPacketType.STAT:
        return "STAT";
      case SftpPacketType.RENAME:
        return "RENAME";
      case SftpPacketType.READLINK:
        return "READLINK";
      case SftpPacketType.SYMLINK:
        return "SYMLINK";
      case SftpPacketType.EXTENDED:
        return "EXTENDED";
      case SftpPacketType.STATUS:
        return "STATUS";
      case SftpPacketType.HANDLE:
        return "HANDLE";
      case SftpPacketType.DATA:
        return "DATA";
      case SftpPacketType.NAME:
        return "NAME";
      case SftpPacketType.ATTRS:
        return "ATTRS";
      case SftpPacketType.EXTENDED_REPLY:
        return "EXTENDED_REPLY";
      default:
        return "" + packetType;
    }
  }
}

export class SftpPacketReader extends SftpPacket {
  constructor(buffer: Buffer, raw?: boolean) {
    super();

    this.buffer = buffer;
    this.position = 0;
    this.length = buffer.length;

    if (!raw) {
      const length = this.readInt32() + 4;
      if (length != this.length) throw new Error("Invalid packet received");

      this.type = this.readByte();
      if (
        this.type == SftpPacketType.INIT ||
        this.type == SftpPacketType.VERSION
      ) {
        this.id = null;
      } else {
        this.id = this.readInt32();

        if (this.type == SftpPacketType.EXTENDED) {
          this.type = this.readString();
        }
      }
    } else {
      this.type = null;
      this.id = null;
    }
  }

  readByte(): number {
    this.check(1);
    const value = this.buffer.readUInt8(this.position++);
    return value;
  }

  readInt16(): number {
    this.check(2);
    const value = this.buffer.readInt16BE(this.position);
    this.position += 2;
    return value;
  }

  readUInt16(): number {
    this.check(2);
    const value = this.buffer.readUInt16BE(this.position);
    this.position += 2;
    return value;
  }

  readInt32(): number {
    this.check(4);
    const value = this.buffer.readInt32BE(this.position);
    this.position += 4;
    return value;
  }

  readUInt32(): number {
    this.check(4);
    const value = this.buffer.readUInt32BE(this.position);
    this.position += 4;
    return value;
  }

  readInt64(): number {
    this.check(8);
    const value = this.buffer.readBigInt64BE(this.position);
    this.position += 8;
    return Number(value);
  }

  readUInt64(): number {
    this.check(8);
    const value = this.buffer.readBigUint64BE(this.position);
    this.position += 8;
    return Number(value);
  }

  readString(): string {
    const length = this.readUInt32();
    this.check(length);
    const end = this.position + length;
    const value = this.buffer.toString("utf8", this.position, end);
    this.position = end;
    return value;
  }

  skipString(): void {
    const length = this.readInt32();
    this.check(length);

    const end = this.position + length;
    this.position = end;
  }

  readData(clone: boolean): Buffer {
    const length = this.readUInt32();
    this.check(length);

    const start = this.position;
    const end = start + length;
    this.position = end;
    if (clone) {
      const buffer = Buffer.alloc(length);
      this.buffer.copy(buffer, 0, start, end);
      return buffer;
    } else {
      return this.buffer.slice(start, end);
    }
  }

  readStructuredData(): SftpPacketReader {
    const data = this.readData(false);
    return new SftpPacketReader(data, true);
  }
}

export class SftpPacketWriter extends SftpPacket {
  constructor(length: number) {
    super();
    this.buffer = Buffer.alloc(length);
    this.position = 0;
    this.length = length;
  }

  start(): void {
    this.position = 0;
    this.writeInt32(0); // length placeholder

    if (typeof this.type === "number") {
      this.writeByte(<number>this.type);
    } else {
      this.writeByte(<number>SftpPacketType.EXTENDED);
    }

    if (
      this.type == SftpPacketType.INIT ||
      this.type == SftpPacketType.VERSION
    ) {
      // these packets don't have an id
    } else {
      this.writeInt32(this.id ?? 0);

      if (typeof this.type !== "number") {
        this.writeString(<string>this.type);
      }
    }
  }

  finish(): Buffer {
    const length = this.position;
    this.position = 0;
    this.buffer.writeInt32BE(length - 4, 0);
    return this.buffer.slice(0, length);
  }

  writeByte(value: number): void {
    this.check(1);
    this.buffer.writeUInt8(value, this.position++);
  }

  writeInt32(value: number): void {
    this.check(4);
    this.buffer.writeInt32BE(value, this.position);
    this.position += 4;
  }

  writeUInt32(value: number): void {
    this.check(4);
    this.buffer.writeUInt32BE(value, this.position);
    this.position += 4;
  }

  writeInt64(value: number): void {
    this.check(8);
    this.buffer.writeBigInt64BE(BigInt(value), this.position);
    this.position += 8;
  }

  writeUInt64(value: number): void {
    this.check(8);
    this.buffer.writeBigUInt64BE(BigInt(value), this.position);
    this.position += 8;
  }

  writeString(value: string): void {
    if (typeof value !== "string") value = "" + value;
    const offset = this.position;
    this.writeInt32(0); // will get overwritten later

    const bytesWritten = encodeUTF8(value, this.buffer, this.position);
    if (bytesWritten < 0) {
      console.warn("writeString: Not enough space in the buffer");
      throw new Error("Not enough space in the buffer");
    }

    // write number of bytes and seek back to the end
    this.position = offset;
    this.writeUInt32(bytesWritten);
    this.position += bytesWritten;
  }

  writeData(data: Buffer, start?: number, end?: number): void {
    if (start != null) {
      data = data.slice(start, end);
    }

    const length = data.length;
    this.writeUInt32(length);

    this.check(length);
    data.copy(this.buffer, this.position, 0, length);
    this.position += length;
  }
}
