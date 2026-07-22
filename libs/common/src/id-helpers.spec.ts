import { ObjectId } from 'mongodb';

jest.mock('mongodb', () => {
  const actual = jest.requireActual('mongodb');
  return { ObjectId: actual.ObjectId };
});

describe('id-helpers', () => {
  let helpers: any;

  beforeAll(() => {
    helpers = require('../../common/src/id-helpers');
  });

  describe('toHex', () => {
    it('should return hex string from ObjectId', () => {
      const oid = new ObjectId();
      expect(helpers.toHex(oid)).toBe(oid.toHexString());
    });

    it('should return the string unchanged', () => {
      expect(helpers.toHex('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
    });

    it('should return empty string for null', () => {
      expect(helpers.toHex(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(helpers.toHex(undefined)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(helpers.toHex('')).toBe('');
    });

    it('should call toHexString on object-like values', () => {
      const mock = { toHexString: () => 'abcdef1234567890abcdef12' };
      expect(helpers.toHex(mock)).toBe('abcdef1234567890abcdef12');
    });

    it('should stringify non-object-id values', () => {
      expect(helpers.toHex(42)).toBe('42');
    });
  });

  describe('toObjectId', () => {
    it('should return ObjectId unchanged', () => {
      const oid = new ObjectId();
      expect(helpers.toObjectId(oid)).toBe(oid);
    });

    it('should create ObjectId from valid 24-char hex string', () => {
      const hex = '507f1f77bcf86cd799439011';
      const result = helpers.toObjectId(hex);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toHexString()).toBe(hex);
    });

    it('should return null for short string', () => {
      expect(helpers.toObjectId('abc')).toBeNull();
    });

    it('should return null for long string', () => {
      expect(helpers.toObjectId('a'.repeat(30))).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(helpers.toObjectId('')).toBeNull();
    });

    it('should return null for null', () => {
      expect(helpers.toObjectId(null)).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(helpers.toObjectId(undefined)).toBeNull();
    });

    it('should return null for non-hex string', () => {
      expect(helpers.toObjectId('zxyw1234567890abcd123456')).toBeNull();
    });

    it('should return null for invalid ObjectId string', () => {
      expect(helpers.toObjectId('not-a-valid-object-id-string')).toBeNull();
    });
  });
});