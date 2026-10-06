import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { loadPreset, DEFAULT_PRESET, PRESET_STORAGE_KEY } from './presets.ts';

describe('loadPreset', () => {
    let mockStorage: Record<string, string> = {};
    let originalLocalStorage: Storage | undefined;

    beforeEach(() => {
        mockStorage = {};
        originalLocalStorage = globalThis.localStorage;

        const localStorageMock = {
            getItem: (key: string) => {
                return mockStorage.hasOwnProperty(key) ? mockStorage[key] : null;
            },
            setItem: (key: string, value: string) => {
                mockStorage[key] = value.toString();
            },
            removeItem: (key: string) => {
                delete mockStorage[key];
            },
            clear: () => {
                mockStorage = {};
            },
            length: 0,
            key: (index: number) => null,
        } as unknown as Storage;

        Object.defineProperty(globalThis, 'localStorage', {
            value: localStorageMock,
            writable: true,
            configurable: true
        });
    });

    afterEach(() => {
        if (originalLocalStorage === undefined) {
            // Use defineProperty to handle possibly non-configurable descriptor on some runtimes,
            // or just delete.
            // @ts-ignore
            delete globalThis.localStorage;
        } else {
            Object.defineProperty(globalThis, 'localStorage', {
                value: originalLocalStorage,
                writable: true,
                configurable: true
            });
        }
    });

    test('Should return DEFAULT_PRESET when localStorage is empty', () => {
        const preset = loadPreset();
        assert.deepStrictEqual(preset, DEFAULT_PRESET);
    });

    test('Should parse and merge stored JSON string with DEFAULT_PRESET', () => {
        mockStorage[PRESET_STORAGE_KEY] = JSON.stringify({ rotationSpeed: 2.0, nonExistentProp: 5 });
        const preset = loadPreset();

        assert.deepStrictEqual(preset, {
            ...DEFAULT_PRESET,
            rotationSpeed: 2.0,
            nonExistentProp: 5
        });
    });

    test('Should return DEFAULT_PRESET when stored data is not valid JSON', () => {
        mockStorage[PRESET_STORAGE_KEY] = 'invalid-json';
        const preset = loadPreset();
        assert.deepStrictEqual(preset, DEFAULT_PRESET);
    });

    test('Should return DEFAULT_PRESET when localStorage.getItem throws an exception', () => {
        const throwingStorage = {
            getItem: () => { throw new Error('Access Denied'); }
        } as unknown as Storage;

        Object.defineProperty(globalThis, 'localStorage', {
            value: throwingStorage,
            writable: true,
            configurable: true
        });

        const preset = loadPreset();
        assert.deepStrictEqual(preset, DEFAULT_PRESET);
    });
});
