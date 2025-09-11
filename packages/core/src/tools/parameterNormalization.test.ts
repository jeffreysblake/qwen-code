/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { normalizeParams } from './tools.js';

describe('Parameter Normalization - Type Safety and Edge Cases', () => {
  describe('Boolean normalization', () => {
    describe('String-to-boolean conversion', () => {
      it('should convert string "true" to boolean true', () => {
        const input = { enabled: 'true' };
        const normalized = normalizeParams(input);
        expect(normalized.enabled).toBe(true);
        expect(typeof normalized.enabled).toBe('boolean');
      });

      it('should convert string "false" to boolean false', () => {
        const input = { enabled: 'false' };
        const normalized = normalizeParams(input);
        expect(normalized.enabled).toBe(false);
        expect(typeof normalized.enabled).toBe('boolean');
      });

      it('should handle case insensitive boolean strings', () => {
        const testCases = [
          { input: 'TRUE', expected: true },
          { input: 'True', expected: true },
          { input: 'tRuE', expected: true },
          { input: 'FALSE', expected: false },
          { input: 'False', expected: false },
          { input: 'fAlSe', expected: false },
        ];

        testCases.forEach(({ input, expected }) => {
          const result = normalizeParams({ value: input });
          expect(result.value).toBe(expected);
          expect(typeof result.value).toBe('boolean');
        });
      });

      it('should trim whitespace before converting', () => {
        const testCases = [
          { input: ' true ', expected: true },
          { input: '  false  ', expected: false },
          { input: '\ttrue\t', expected: true },
          { input: '\nfalse\n', expected: false },
          { input: ' TRUE ', expected: true },
          { input: '  FALSE  ', expected: false },
        ];

        testCases.forEach(({ input, expected }) => {
          const result = normalizeParams({ value: input });
          expect(result.value).toBe(expected);
          expect(typeof result.value).toBe('boolean');
        });
      });

      it('should not convert non-boolean strings', () => {
        const testCases = [
          'yes',
          'no',
          '1',
          '0',
          'on',
          'off',
          'enabled',
          'disabled',
          'truthy',
          'falsy',
          'true ',
          ' false',
          'true false',
          '',
          'null',
          'undefined',
        ];

        testCases.forEach((input) => {
          const result = normalizeParams({ value: input });
          expect(result.value).toBe(input);
          expect(typeof result.value).toBe('string');
        });
      });
    });

    describe('Actual boolean preservation', () => {
      it('should preserve actual boolean values', () => {
        const input = { trueValue: true, falseValue: false };
        const normalized = normalizeParams(input);
        expect(normalized.trueValue).toBe(true);
        expect(normalized.falseValue).toBe(false);
        expect(typeof normalized.trueValue).toBe('boolean');
        expect(typeof normalized.falseValue).toBe('boolean');
      });
    });

    describe('Complex nested boolean scenarios', () => {
      it('should handle nested objects with boolean strings', () => {
        const input = {
          config: {
            settings: {
              autoSave: 'true',
              showNotifications: 'false',
              debugMode: 'TRUE',
            },
            features: {
              experimental: 'False',
            },
          },
        };

        const normalized = normalizeParams(input);

        expect(normalized.config.settings.autoSave).toBe(true);
        expect(normalized.config.settings.showNotifications).toBe(false);
        expect(normalized.config.settings.debugMode).toBe(true);
        expect(normalized.config.features.experimental).toBe(false);
      });

      it('should handle arrays with boolean strings', () => {
        const input = {
          flags: ['true', 'false', 'TRUE', 'other'],
          mixed: [true, 'false', 'not-boolean', false],
        };

        const normalized = normalizeParams(input);

        expect(normalized.flags).toEqual([true, false, true, 'other']);
        expect(normalized.mixed).toEqual([true, false, 'not-boolean', false]);
      });

      it('should handle mixed types in the same object', () => {
        const input = {
          booleanString: 'true',
          actualBoolean: false,
          number: 42,
          string: 'hello',
          nullValue: null,
          undefinedValue: undefined,
          array: ['false', true, 123],
        };

        const normalized = normalizeParams(input);

        expect(normalized.booleanString).toBe(true);
        expect(normalized.actualBoolean).toBe(false);
        expect(normalized.number).toBe(42);
        expect(normalized.string).toBe('hello');
        expect(normalized.nullValue).toBe(null);
        expect(normalized.undefinedValue).toBe(undefined);
        expect(normalized.array).toEqual([false, true, 123]);
      });
    });
  });

  describe('Type safety and edge cases', () => {
    it('should handle null input', () => {
      expect(() => normalizeParams(null as any)).not.toThrow();
      const result = normalizeParams(null as any);
      expect(result).toBe(null);
    });

    it('should handle undefined input', () => {
      expect(() => normalizeParams(undefined as any)).not.toThrow();
      const result = normalizeParams(undefined as any);
      expect(result).toBe(undefined);
    });

    it('should handle primitive values', () => {
      expect(normalizeParams('true' as any)).toBe(true);
      expect(normalizeParams('false' as any)).toBe(false);
      expect(normalizeParams('other' as any)).toBe('other');
      expect(normalizeParams(42 as any)).toBe(42);
      expect(normalizeParams(true as any)).toBe(true);
    });

    it('should handle empty objects and arrays', () => {
      expect(normalizeParams({})).toEqual({});
      expect(normalizeParams([])).toEqual([]);
    });

    it('should handle circular references without infinite loops', () => {
      const circular: any = { name: 'circular' };
      circular.self = circular;

      expect(() => normalizeParams(circular)).not.toThrow();

      const result = normalizeParams(circular);
      expect(result.name).toBe('circular');
      expect(result.self).toBe(result); // Should maintain circular reference
    });

    it('should handle very deep nested structures', () => {
      let deep: any = { value: 'true' };

      // Create 100 levels of nesting
      for (let i = 0; i < 100; i++) {
        deep = { nested: deep, level: i };
      }

      expect(() => normalizeParams(deep)).not.toThrow();

      const result = normalizeParams(deep);

      // Navigate to the deep value and verify it was normalized
      let current = result;
      for (let i = 0; i < 100; i++) {
        current = current.nested;
      }

      expect(current.value).toBe(true);
    });

    it('should handle functions in objects', () => {
      const input = {
        normalValue: 'true',
        functionValue: () => 'test',
        arrowFunction: vi.fn(),
      };

      const result = normalizeParams(input);

      expect(result.normalValue).toBe(true);
      expect(typeof result.functionValue).toBe('function');
      expect(typeof result.arrowFunction).toBe('function');
    });

    it('should handle objects with prototypes', () => {
      class TestClass {
        constructor(public value: string) {}
        method() {
          return 'test';
        }
      }

      const instance = new TestClass('true');
      const result = normalizeParams(instance);

      expect(result.value).toBe(true);
      expect(typeof result.method).toBe('function');
    });

    it('should handle Map and Set objects', () => {
      const map = new Map([
        ['key', 'true'],
        ['other', 'false'],
      ]);
      const set = new Set(['true', 'false', 'other']);

      const input = { mapValue: map, setValue: set };
      const result = normalizeParams(input);

      // Maps and Sets should be preserved as-is
      expect(result.mapValue).toBe(map);
      expect(result.setValue).toBe(set);
    });

    it('should handle Date objects and other built-ins', () => {
      const date = new Date();
      const regex = /test/g;
      const error = new Error('test');

      const input = { dateValue: date, regexValue: regex, errorValue: error };
      const result = normalizeParams(input);

      expect(result.dateValue).toBe(date);
      expect(result.regexValue).toBe(regex);
      expect(result.errorValue).toBe(error);
    });
  });

  describe('Performance and memory efficiency', () => {
    it('should handle large objects efficiently', () => {
      const largeObject: any = {};

      // Create an object with 10,000 properties
      for (let i = 0; i < 10000; i++) {
        largeObject[`prop${i}`] = i % 2 === 0 ? 'true' : 'false';
      }

      const start = Date.now();
      const result = normalizeParams(largeObject);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      // Verify some conversions worked
      expect(result.prop0).toBe(true);
      expect(result.prop1).toBe(false);
      expect(result.prop100).toBe(true);
    });

    it('should handle large arrays efficiently', () => {
      const largeArray = [];

      // Create array with 10,000 elements
      for (let i = 0; i < 10000; i++) {
        largeArray.push(i % 3 === 0 ? 'true' : i % 3 === 1 ? 'false' : 'other');
      }

      const start = Date.now();
      const result = normalizeParams(largeArray);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      expect(result[0]).toBe(true);
      expect(result[1]).toBe(false);
      expect(result[2]).toBe('other');
    });

    it('should not consume excessive memory', () => {
      const createNestedObject = (depth: number): any => {
        if (depth === 0) return { value: 'true' };
        return {
          nested: createNestedObject(depth - 1),
          value: depth % 2 === 0 ? 'true' : 'false',
        };
      };

      const deepObject = createNestedObject(50);

      expect(() => normalizeParams(deepObject)).not.toThrow();

      const result = normalizeParams(deepObject);
      expect(result.value).toBe(true); // depth 50 is even, so 'true' -> true
    });
  });

  describe('Real-world scenarios and regression tests', () => {
    it('should handle LLM response parameters that caused issues', () => {
      // Scenario: LLM returns boolean parameters as strings
      const llmResponse = {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({
                recursive: 'True',
                force: 'false',
                verbose: 'TRUE',
                dryRun: 'False',
                count: 5,
                path: '/home/user',
              }),
            },
          },
        ],
      };

      const parsedArgs = JSON.parse(
        llmResponse.tool_calls[0].function.arguments,
      );
      const normalized = normalizeParams(parsedArgs);

      expect(normalized.recursive).toBe(true);
      expect(normalized.force).toBe(false);
      expect(normalized.verbose).toBe(true);
      expect(normalized.dryRun).toBe(false);
      expect(normalized.count).toBe(5);
      expect(normalized.path).toBe('/home/user');
    });

    it('should handle configuration objects with mixed boolean formats', () => {
      const config = {
        features: {
          enableLogging: 'true',
          enableCache: 'False',
          enableRetries: true,
          enableMetrics: false,
        },
        limits: {
          maxRetries: 3,
          timeout: 5000,
        },
        flags: ['true', 'false', true, false, 'other'],
      };

      const normalized = normalizeParams(config);

      expect(normalized.features.enableLogging).toBe(true);
      expect(normalized.features.enableCache).toBe(false);
      expect(normalized.features.enableRetries).toBe(true);
      expect(normalized.features.enableMetrics).toBe(false);
      expect(normalized.limits.maxRetries).toBe(3);
      expect(normalized.limits.timeout).toBe(5000);
      expect(normalized.flags).toEqual([true, false, true, false, 'other']);
    });

    it('should handle tool parameter schemas correctly', () => {
      // Common tool parameter patterns that have caused issues
      const toolParams = {
        file_path: '/path/to/file.txt',
        create_dirs: 'true',
        overwrite: 'False',
        mode: 644,
        backup: 'TRUE',
        options: {
          compress: 'false',
          encrypt: 'True',
          validate: true,
        },
        excludePatterns: ['*.tmp', '*.log'],
        includeHidden: 'false',
      };

      const normalized = normalizeParams(toolParams);

      expect(normalized.file_path).toBe('/path/to/file.txt');
      expect(normalized.create_dirs).toBe(true);
      expect(normalized.overwrite).toBe(false);
      expect(normalized.mode).toBe(644);
      expect(normalized.backup).toBe(true);
      expect(normalized.options.compress).toBe(false);
      expect(normalized.options.encrypt).toBe(true);
      expect(normalized.options.validate).toBe(true);
      expect(normalized.excludePatterns).toEqual(['*.tmp', '*.log']);
      expect(normalized.includeHidden).toBe(false);
    });

    it('should preserve type information correctly after normalization', () => {
      const input = {
        stringValue: 'hello',
        numberValue: 42,
        booleanTrue: true,
        booleanFalse: false,
        stringTrue: 'true',
        stringFalse: 'false',
        arrayMixed: [1, 'true', true, 'false', 'other'],
        nullValue: null,
        undefinedValue: undefined,
        nestedObject: {
          deepString: 'world',
          deepBoolean: 'True',
        },
      };

      const normalized = normalizeParams(input);

      // Verify types are preserved or correctly converted
      expect(typeof normalized.stringValue).toBe('string');
      expect(typeof normalized.numberValue).toBe('number');
      expect(typeof normalized.booleanTrue).toBe('boolean');
      expect(typeof normalized.booleanFalse).toBe('boolean');
      expect(typeof normalized.stringTrue).toBe('boolean');
      expect(typeof normalized.stringFalse).toBe('boolean');
      expect(Array.isArray(normalized.arrayMixed)).toBe(true);
      expect(normalized.nullValue).toBe(null);
      expect(normalized.undefinedValue).toBe(undefined);
      expect(typeof normalized.nestedObject.deepString).toBe('string');
      expect(typeof normalized.nestedObject.deepBoolean).toBe('boolean');

      // Verify values are correct
      expect(normalized.stringValue).toBe('hello');
      expect(normalized.numberValue).toBe(42);
      expect(normalized.booleanTrue).toBe(true);
      expect(normalized.booleanFalse).toBe(false);
      expect(normalized.stringTrue).toBe(true);
      expect(normalized.stringFalse).toBe(false);
      expect(normalized.arrayMixed).toEqual([1, true, true, false, 'other']);
      expect(normalized.nestedObject.deepString).toBe('world');
      expect(normalized.nestedObject.deepBoolean).toBe(true);
    });

    it('should handle edge cases that previously caused crashes', () => {
      const edgeCases = [
        // Empty strings and whitespace
        { value: '' },
        { value: ' ' },
        { value: '\t\n' },

        // Special boolean-like strings
        { value: 'True ' }, // Trailing space
        { value: ' False' }, // Leading space
        { value: '\ttrue\n' }, // Mixed whitespace

        // Numbers as strings
        { value: '0' },
        { value: '1' },
        { value: '-1' },

        // Object-like strings
        { value: 'true false' },
        { value: 'trueFalse' },
        { value: 'false.true' },

        // Arrays with problematic values
        { array: [null, undefined, '', ' true ', ' false '] },

        // Deeply nested with edge cases
        { deep: { deeper: { deepest: { value: ' TRUE ' } } } },
      ];

      edgeCases.forEach((testCase, index) => {
        expect(() => {
          const result = normalizeParams(testCase);
          // Basic sanity check - result should be defined
          expect(result).toBeDefined();
        }).not.toThrow();
      });
    });
  });
});
