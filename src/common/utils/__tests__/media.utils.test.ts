import { describe, it, expect } from '@jest/globals';
import { getExtensionFromContentType, generateStorageKey } from '../media.utils.js';

describe('media.utils', () => {
  describe('getExtensionFromContentType', () => {
    it('returns .jpg for image/jpeg', () => {
      expect(getExtensionFromContentType('image/jpeg')).toBe('.jpg');
    });

    it('returns .jpg for image/jpg', () => {
      expect(getExtensionFromContentType('image/jpg')).toBe('.jpg');
    });

    it('returns .png for image/png', () => {
      expect(getExtensionFromContentType('image/png')).toBe('.png');
    });

    it('returns .mp4 for video/mp4', () => {
      expect(getExtensionFromContentType('video/mp4')).toBe('.mp4');
    });

    it('returns empty string for undefined or unknown MIME', () => {
      expect(getExtensionFromContentType(undefined)).toBe('');
      expect(getExtensionFromContentType('application/octet-stream')).toBe('');
    });
  });

  describe('generateStorageKey', () => {
    it('generates deterministic S3 key with extension', () => {
      const key = generateStorageKey('h-123', 'm-456', 'image/jpeg');
      expect(key).toBe('hashtags/h-123/m-456.jpg');
    });

    it('generates key without extension when contentType is missing', () => {
      const key = generateStorageKey('h-123', 'm-456');
      expect(key).toBe('hashtags/h-123/m-456');
    });
  });
});
