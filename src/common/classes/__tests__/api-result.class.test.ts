import { describe, it, expect } from '@jest/globals';
import { ApiResult } from '../api-result.class.js';

describe('ApiResult class', () => {
  it('instantiates with defaults and isError=false', () => {
    const result = new ApiResult();

    expect(result.isError).toBe(false);
    expect(result.message).toBeUndefined();
    expect(result.id).toBeUndefined();
    expect(result.result).toBeUndefined();
  });

  it('instantiates with message, id, and result object', () => {
    const payload = { data: [1, 2, 3] };
    const result = new ApiResult('Success', 123, payload);

    expect(result.message).toBe('Success');
    expect(result.id).toBe(123);
    expect(result.result).toEqual(payload);
    expect(result.isError).toBe(false);
  });

  it('supports string id and optional details', () => {
    const result = new ApiResult('Entity created', 'uuid-123', { name: 'test' });
    result.details = 'Extra details';

    expect(result.message).toBe('Entity created');
    expect(result.id).toBe('uuid-123');
    expect(result.details).toBe('Extra details');
    expect(result.result).toEqual({ name: 'test' });
  });
});
