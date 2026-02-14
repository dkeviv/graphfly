import { b } from './b';

export function a() {
  return b();
}

/**
 * Builds a greeting message.
 *
 * @param {string} name - User display name.
 * @param {'formal'|'casual'} tone - Output style.
 * @param {number} retries - Retry attempts.
 * @min retries 0
 * @max retries 5
 * @returns {string}
 */
export function greet(name, tone, retries) {
  return `${tone}:${name}:${retries}`;
}

/**
 * Sample class with a constrained field.
 *
 * @param {'small'|'large'} size - Widget size.
 */
export class Widget {
  constructor(size) {
    this.size = size;
  }
}
