class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value));
  }
}

// Node 26 在未提供 backing file 时会暴露不可用的全局 localStorage getter；
// 测试使用确定性的内存存储即可，不依赖本机文件。
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  writable: true,
  value: new MemoryStorage(),
});
