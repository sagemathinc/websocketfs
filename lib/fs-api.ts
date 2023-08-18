export const enum FileType {
  FIFO = 0x1000,
  CHARACTER_DEVICE = 0x2000,
  DIRECTORY = 0x4000,
  BLOCK_DEVICE = 0x6000,
  REGULAR_FILE = 0x8000,
  SYMLINK = 0xa000,
  SOCKET = 0xc000,

  ALL = 0xf000,
}

export interface IStats {
  mode?: number;
  uid?: number;
  gid?: number;
  size?: number;
  atime?: Date;
  mtime?: Date;
  metadata?: { [key: string]: string };

  isFile?(): boolean;
  isDirectory?(): boolean;
  isSymbolicLink?(): boolean;
}

export interface IItem {
  filename: string;
  stats: IStats;

  longname?: string;
  path?: string;
}

export const enum RenameFlags {
  NONE = 0,
  OVERWRITE = 1,
  //ATOMIC = 2,
  //NATIVE = 4,
}

export interface IFilesystem {
  open(
    path: string,
    flags: string,
    attrs: IStats | undefined,
    callback: (err: Error | null, handle: any) => any,
  ): void;
  close(handle: any, callback: (err: Error | null) => any): void;
  read(
    handle: any,
    buffer: Buffer | null,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, buffer: Buffer, bytesRead: number) => any,
  ): void;
  write(
    handle: any,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null) => any,
  ): void;
  lstat(
    path: string,
    callback: (err: Error | null, attrs?: IStats) => any,
  ): void;
  fstat(
    handle: any,
    callback: (err: Error | null, attrs?: IStats) => any,
  ): void;
  setstat(
    path: string,
    attrs: IStats,
    callback: (err: Error | null) => any,
  ): void;
  fsetstat(
    handle: any,
    attrs: IStats,
    callback: (err: Error | null) => any,
  ): void;
  opendir(
    path: string,
    callback: (err: Error | null, handle?: any) => any,
  ): void;
  readdir(
    handle: any,
    callback: (err: Error | null, items?: IItem[] | boolean) => any,
  ): void;
  unlink(path: string, callback: (err: Error | null) => any): void;
  mkdir(
    path: string,
    attrs: IStats | undefined,
    callback: (err: Error | null) => any,
  ): void;
  rmdir(path: string, callback: (err: Error | null) => any): void;
  realpath(
    path: string,
    callback: (err: Error | null, resolvedPath?: string) => any,
  ): void;
  stat(
    path: string,
    callback: (err: Error | null, attrs?: IStats) => any,
  ): void;
  rename(
    oldPath: string,
    newPath: string,
    flags: RenameFlags,
    callback: (err: Error | null) => any,
  ): void;
  readlink(
    path: string,
    callback: (err: Error | null, linkString?: string) => any,
  ): void;
  symlink(
    oldPath: string,
    newPath: string,
    callback: (err: Error | null) => any,
  ): void;
  link(
    oldPath: string,
    newPath: string,
    callback: (err: Error | null) => any,
  ): void;

  fcopy?(
    fromHandle: any,
    fromPosition: number,
    length: number,
    toHandle: any,
    toPosition: number,
    callback: (err: Error | null) => any,
  ): void;
  fhash?(
    handle: any,
    alg: string,
    position: number,
    length: number,
    blockSize: number,
    callback: (err: Error | null, hashes?: Buffer, alg?: string) => any,
  ): void;
}
