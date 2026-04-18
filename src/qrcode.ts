type Byte = number;

const BYTE_MODE_INDICATOR = 0b0100;
const DEFAULT_MASK = 0;
const MEDIUM_FORMAT_BITS = 0;

const ECC_CODEWORDS_PER_BLOCK = [
  -1,
  10,
  16,
  26,
  18,
  24,
  16,
  18,
  22,
  22,
  26,
  30,
  22,
  22,
  24,
  24,
  28,
  28,
  26,
  26,
  26,
  26,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28
] as const;

const NUM_ERROR_CORRECTION_BLOCKS = [
  -1,
  1,
  1,
  1,
  2,
  2,
  4,
  4,
  4,
  5,
  5,
  5,
  8,
  9,
  9,
  10,
  10,
  11,
  13,
  14,
  16,
  17,
  17,
  18,
  20,
  21,
  23,
  25,
  26,
  28,
  29,
  31,
  33,
  35,
  37,
  38,
  40,
  43,
  45,
  47,
  49
] as const;

export class QrCode {
  static encodeText(text: string) {
    const data = Array.from(new TextEncoder().encode(text));
    return QrCode.encodeBytes(data);
  }

  private static encodeBytes(data: number[]) {
    let version = 1;

    for (; version <= 40; version += 1) {
      const dataCapacityBits = QrCode.getNumDataCodewords(version) * 8;
      const usedBits = 4 + getByteModeCharacterCountBits(version) + data.length * 8;

      if (usedBits <= dataCapacityBits) {
        break;
      }
    }

    if (version > 40) {
      throw new RangeError('Data too long');
    }

    const dataCapacityBits = QrCode.getNumDataCodewords(version) * 8;
    const bitBuffer: number[] = [];
    appendBits(BYTE_MODE_INDICATOR, 4, bitBuffer);
    appendBits(data.length, getByteModeCharacterCountBits(version), bitBuffer);

    for (const value of data) {
      appendBits(value, 8, bitBuffer);
    }

    appendBits(0, Math.min(4, dataCapacityBits - bitBuffer.length), bitBuffer);
    appendBits(0, (8 - (bitBuffer.length % 8)) % 8, bitBuffer);

    for (let padByte = 0xec; bitBuffer.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
      appendBits(padByte, 8, bitBuffer);
    }

    const dataCodewords: Byte[] = new Array(bitBuffer.length / 8).fill(0);
    bitBuffer.forEach((bit, index) => {
      dataCodewords[index >>> 3] |= bit << (7 - (index & 7));
    });

    return new QrCode(version, dataCodewords);
  }

  readonly mask = DEFAULT_MASK;
  readonly size: number;
  readonly version: number;

  private readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  private constructor(version: number, dataCodewords: Byte[]) {
    if (version < 1 || version > 40) {
      throw new RangeError('Version number out of range');
    }

    if (dataCodewords.length !== QrCode.getNumDataCodewords(version)) {
      throw new RangeError('Invalid data length');
    }

    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => Array<boolean>(this.size).fill(false));

    this.drawFunctionPatterns();
    const allCodewords = this.addErrorCorrectionAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    this.applyMaskZero();
    this.drawFormatBits(this.mask);
  }

  getModule(x: number, y: number) {
    return (
      0 <= x &&
      x < this.size &&
      0 <= y &&
      y < this.size &&
      this.modules[y]?.[x] === true
    );
  }

  private drawFunctionPatterns() {
    for (let index = 0; index < this.size; index += 1) {
      const isDark = index % 2 === 0;
      this.setFunctionModule(6, index, isDark);
      this.setFunctionModule(index, 6, isDark);
    }

    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const alignmentPositions = QrCode.getAlignmentPatternPositions(this.version);
    for (const y of alignmentPositions) {
      for (const x of alignmentPositions) {
        const isCornerPattern =
          (x === 6 && y === 6) ||
          (x === 6 && y === this.size - 7) ||
          (x === this.size - 7 && y === 6);

        if (!isCornerPattern) {
          this.drawAlignmentPattern(x, y);
        }
      }
    }

    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFormatBits(mask: number) {
    let data = (MEDIUM_FORMAT_BITS << 3) | mask;
    let remainder = data;

    for (let index = 0; index < 10; index += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }

    const bits = ((data << 10) | remainder) ^ 0x5412;

    for (let index = 0; index <= 5; index += 1) {
      this.setFunctionModule(8, index, getBit(bits, index));
    }

    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));

    for (let index = 9; index < 15; index += 1) {
      this.setFunctionModule(14 - index, 8, getBit(bits, index));
    }

    for (let index = 0; index < 8; index += 1) {
      this.setFunctionModule(this.size - 1 - index, 8, getBit(bits, index));
    }

    for (let index = 8; index < 15; index += 1) {
      this.setFunctionModule(8, this.size - 15 + index, getBit(bits, index));
    }

    this.setFunctionModule(8, this.size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) {
      return;
    }

    let remainder = this.version;
    for (let index = 0; index < 12; index += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }

    const bits = (this.version << 12) | remainder;
    for (let index = 0; index < 18; index += 1) {
      const isDark = getBit(bits, index);
      const x = this.size - 11 + (index % 3);
      const y = Math.floor(index / 3);
      this.setFunctionModule(x, y, isDark);
      this.setFunctionModule(y, x, isDark);
    }
  }

  private drawFinderPattern(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const moduleX = x + dx;
        const moduleY = y + dy;

        if (
          0 <= moduleX &&
          moduleX < this.size &&
          0 <= moduleY &&
          moduleY < this.size
        ) {
          this.setFunctionModule(moduleX, moduleY, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        this.setFunctionModule(
          x + dx,
          y + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1
        );
      }
    }
  }

  private setFunctionModule(x: number, y: number, isDark: boolean) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  private addErrorCorrectionAndInterleave(dataCodewords: Byte[]) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[this.version];
    const blockErrorCorrectionLength = ECC_CODEWORDS_PER_BLOCK[this.version];
    const rawCodewords = Math.floor(QrCode.getNumRawDataModules(this.version) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLength = Math.floor(rawCodewords / numBlocks);
    const rsDivisor = QrCode.reedSolomonComputeDivisor(blockErrorCorrectionLength);
    const blocks: Byte[][] = [];

    for (let blockIndex = 0, dataIndex = 0; blockIndex < numBlocks; blockIndex += 1) {
      const dataLength =
        shortBlockLength -
        blockErrorCorrectionLength +
        (blockIndex < numShortBlocks ? 0 : 1);
      const dataBlock = dataCodewords.slice(dataIndex, dataIndex + dataLength);
      dataIndex += dataBlock.length;

      const errorCorrection = QrCode.reedSolomonComputeRemainder(dataBlock, rsDivisor);
      if (blockIndex < numShortBlocks) {
        dataBlock.push(0);
      }

      blocks.push([...dataBlock, ...errorCorrection]);
    }

    const result: Byte[] = [];
    for (let codewordIndex = 0; codewordIndex < blocks[0].length; codewordIndex += 1) {
      blocks.forEach((block, blockIndex) => {
        const isPaddingByte = codewordIndex === shortBlockLength - blockErrorCorrectionLength;
        if (!isPaddingByte || blockIndex >= numShortBlocks) {
          result.push(block[codewordIndex]);
        }
      });
    }

    return result;
  }

  private drawCodewords(codewords: Byte[]) {
    let bitIndex = 0;
    const totalBitCount = codewords.length * 8;

    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }

      const isUpward = ((right + 1) & 2) === 0;
      for (let verticalIndex = 0; verticalIndex < this.size; verticalIndex += 1) {
        const y = isUpward ? this.size - 1 - verticalIndex : verticalIndex;

        for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
          const x = right - columnOffset;
          if (!this.isFunction[y][x] && bitIndex < totalBitCount) {
            this.modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex += 1;
          }
        }
      }
    }
  }

  private applyMaskZero() {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (!this.isFunction[y][x] && (x + y) % 2 === 0) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  private static getAlignmentPatternPositions(version: number) {
    if (version === 1) {
      return [] as number[];
    }

    const numAlignments = Math.floor(version / 7) + 2;
    const step =
      version === 32
        ? 26
        : Math.floor((version * 8 + numAlignments * 3 + 5) / (numAlignments * 4 - 4)) * 2;
    const positions = [6];

    for (let position = version * 4 + 10; positions.length < numAlignments; position -= step) {
      positions.splice(1, 0, position);
    }

    return positions;
  }

  private static getNumRawDataModules(version: number) {
    if (version < 1 || version > 40) {
      throw new RangeError('Version number out of range');
    }

    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const numAlignments = Math.floor(version / 7) + 2;
      result -= (25 * numAlignments - 10) * numAlignments - 55;
      if (version >= 7) {
        result -= 36;
      }
    }

    return result;
  }

  private static getNumDataCodewords(version: number) {
    return (
      Math.floor(QrCode.getNumRawDataModules(version) / 8) -
      ECC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version]
    );
  }

  private static reedSolomonComputeDivisor(degree: number) {
    if (degree < 1 || degree > 255) {
      throw new RangeError('Degree out of range');
    }

    const result: Byte[] = new Array(degree).fill(0);
    result[result.length - 1] = 1;
    let root = 1;

    for (let index = 0; index < degree; index += 1) {
      for (let coefficientIndex = 0; coefficientIndex < result.length; coefficientIndex += 1) {
        result[coefficientIndex] = QrCode.reedSolomonMultiply(result[coefficientIndex], root);
        if (coefficientIndex + 1 < result.length) {
          result[coefficientIndex] ^= result[coefficientIndex + 1];
        }
      }

      root = QrCode.reedSolomonMultiply(root, 0x02);
    }

    return result;
  }

  private static reedSolomonComputeRemainder(data: readonly Byte[], divisor: readonly Byte[]) {
    const result: Byte[] = divisor.map(() => 0);

    for (const value of data) {
      const factor = value ^ (result.shift() ?? 0);
      result.push(0);
      divisor.forEach((coefficient, index) => {
        result[index] ^= QrCode.reedSolomonMultiply(coefficient, factor);
      });
    }

    return result;
  }

  private static reedSolomonMultiply(x: Byte, y: Byte) {
    if (x >>> 8 !== 0 || y >>> 8 !== 0) {
      throw new RangeError('Byte out of range');
    }

    let result = 0;
    for (let index = 7; index >= 0; index -= 1) {
      result = (result << 1) ^ ((result >>> 7) * 0x11d);
      result ^= ((y >>> index) & 1) * x;
    }

    return result;
  }
}

export function buildQrSvgPath(qrCode: QrCode, border = 2) {
  const pathCommands: string[] = [];

  for (let y = 0; y < qrCode.size; y += 1) {
    for (let x = 0; x < qrCode.size; x += 1) {
      if (!qrCode.getModule(x, y)) {
        continue;
      }

      const moduleX = x + border;
      const moduleY = y + border;
      pathCommands.push(`M${moduleX},${moduleY}h1v1h-1z`);
    }
  }

  return pathCommands.join('');
}

function getByteModeCharacterCountBits(version: number) {
  return version <= 9 ? 8 : 16;
}

function appendBits(value: number, bitCount: number, bitBuffer: number[]) {
  if (bitCount < 0 || bitCount > 31 || value >>> bitCount !== 0) {
    throw new RangeError('Value out of range');
  }

  for (let index = bitCount - 1; index >= 0; index -= 1) {
    bitBuffer.push((value >>> index) & 1);
  }
}

function getBit(value: number, bitIndex: number) {
  return ((value >>> bitIndex) & 1) !== 0;
}
