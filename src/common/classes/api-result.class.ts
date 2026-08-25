/**
 * Class representing API call result
 */
export class ApiResult<T = unknown> {
  id?: number | string;
  message?: string;
  details?: string;
  result?: T;
  isError?: boolean;

  /**
   * Constructor
   * @param message Message text
   * @param id Entity id
   * @param result Result object
   */
  constructor(message?: string, id?: number | string, result?: T) {
    this.message = message;
    this.id = id;
    this.result = result;
    this.isError = false;
  }
}
