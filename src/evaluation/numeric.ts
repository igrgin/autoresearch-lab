// #61: transport binary64 bits, interpret both operands as exact rationals.
export class CheckpointError extends Error {
  constructor(readonly code: 'invalid_input' | 'conflict' | 'integrity_failure' | 'storage_unavailable' | 'insufficient_space') {
    super(`Checkpoint selection: ${code}.`);
  }
}
export function requireValue(condition: unknown, code: CheckpointError['code'] = 'invalid_input'): asserts condition {
  if (!condition) throw new CheckpointError(code);
}
export type Rational = { numerator: bigint; denominator: bigint };
export function decimal(text: string): Rational {
  requireValue(typeof text === 'string' && text.length <= 400 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(text));
  const [whole, fraction = ''] = text.split('.');
  return { numerator: BigInt(whole + fraction), denominator: 10n ** BigInt(fraction.length) };
}
export function binary64(bits: string): Rational {
  requireValue(typeof bits === 'string' && /^[0-9a-f]{16}$/.test(bits));
  const raw = BigInt(`0x${bits}`);
  const exponent = Number((raw >> 52n) & 2047n);
  requireValue(exponent !== 2047);
  const fraction = raw & ((1n << 52n) - 1n);
  const significand = exponent === 0 ? fraction : fraction + (1n << 52n);
  const power = exponent === 0 ? -1074 : exponent - 1075;
  const sign = raw >> 63n ? -1n : 1n;
  return power >= 0 ? { numerator: sign * significand * (1n << BigInt(power)), denominator: 1n }
    : { numerator: sign * significand, denominator: 1n << BigInt(-power) };
}
export function encodeBinary64(value: number): string {
  requireValue(typeof value === 'number' && Number.isFinite(value));
  const bytes = Buffer.alloc(8); bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
  return bytes.toString('hex');
}
export function normalizeBits(bits: string): string {
  return binary64(bits).numerator === 0n ? '0000000000000000' : bits;
}
export function compare(a: Rational, b: Rational): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function rankingKey(bits: string, quantum: string): string {
  requireValue(typeof quantum === 'string' && /^(1[0]*|0\.0*1)$/.test(quantum));
  const x = binary64(bits), q = decimal(quantum);
  const signed = x.numerator * q.denominator;
  const numerator = signed < 0n ? -signed : signed;
  const denominator = x.denominator * q.numerator;
  const quotient = numerator / denominator, remainder = numerator % denominator;
  const roundUp = remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n);
  return ((signed < 0n ? -1n : 1n) * (quotient + (roundUp ? 1n : 0n))).toString();
}
